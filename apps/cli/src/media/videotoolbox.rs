//! H.264 encoding with Apple VideoToolbox (the media engine on Apple Silicon).
//!
//! Frames go in as BGRA pixel buffers tagged BT.709; the encoder does the colour conversion and
//! returns AVCC samples (4-byte length prefixes), which the MP4 muxer writes as they are. B-frames
//! are off, so samples come back in display order and need no composition offsets.
#![allow(non_upper_case_globals, non_snake_case, clippy::upper_case_acronyms)]

use anyhow::{anyhow, bail, Result};
use std::ffi::c_void;
use std::ptr;
use std::sync::{Arc, Mutex};

use super::encoder::EncodedVideo;

type OSStatus = i32;
type CFTypeRef = *const c_void;
type CFStringRef = *const c_void;
type CFDictionaryRef = *const c_void;
type CFArrayRef = *const c_void;
type CFBooleanRef = *const c_void;
type CFNumberRef = *const c_void;
type CFAllocatorRef = *const c_void;
type VTCompressionSessionRef = *mut c_void;
type CVPixelBufferRef = *mut c_void;
type CVPixelBufferPoolRef = *mut c_void;
type CMSampleBufferRef = *mut c_void;
type CMBlockBufferRef = *mut c_void;
type CMFormatDescriptionRef = *mut c_void;

#[repr(C)]
#[derive(Clone, Copy)]
struct CMTime {
    value: i64,
    timescale: i32,
    flags: u32,
    epoch: i64,
}

const CMTIME_VALID: u32 = 1;
const CMTIME_INVALID: CMTime = CMTime {
    value: 0,
    timescale: 0,
    flags: 0,
    epoch: 0,
};

#[repr(C)]
struct CFDictionaryCallBacks {
    _private: [u8; 0],
}

type OutputCallback = extern "C" fn(
    refcon: *mut c_void,
    source_frame_refcon: *mut c_void,
    status: OSStatus,
    info_flags: u32,
    sample_buffer: CMSampleBufferRef,
);

const K_CMVIDEO_CODEC_TYPE_H264: u32 = u32::from_be_bytes(*b"avc1");
/// NV12, limited range: we convert to BT.709 ourselves, on all cores, so the encoder never waits
/// for a colour conversion on the (busy) GPU.
const K_CVPIXEL_FORMAT_TYPE_420V: u32 = u32::from_be_bytes(*b"420v");
const K_CFNUMBER_SINT32_TYPE: isize = 3;
const K_CFNUMBER_FLOAT64_TYPE: isize = 6;
const K_CVATTACHMENT_MODE_SHOULD_PROPAGATE: u32 = 1;
const K_VTENCODE_INFO_FRAME_DROPPED: u32 = 1 << 1;

#[link(name = "CoreFoundation", kind = "framework")]
extern "C" {
    static kCFBooleanTrue: CFBooleanRef;
    static kCFBooleanFalse: CFBooleanRef;
    static kCFTypeDictionaryKeyCallBacks: CFDictionaryCallBacks;
    static kCFTypeDictionaryValueCallBacks: CFDictionaryCallBacks;
    fn CFRelease(cf: CFTypeRef);
    fn CFNumberCreate(
        allocator: CFAllocatorRef,
        the_type: isize,
        value: *const c_void,
    ) -> CFNumberRef;
    fn CFDictionaryCreate(
        allocator: CFAllocatorRef,
        keys: *const CFTypeRef,
        values: *const CFTypeRef,
        count: isize,
        key_callbacks: *const CFDictionaryCallBacks,
        value_callbacks: *const CFDictionaryCallBacks,
    ) -> CFDictionaryRef;
    fn CFDictionaryGetValue(dict: CFDictionaryRef, key: CFTypeRef) -> CFTypeRef;
    fn CFArrayGetCount(array: CFArrayRef) -> isize;
    fn CFArrayGetValueAtIndex(array: CFArrayRef, index: isize) -> CFTypeRef;
    fn CFBooleanGetValue(boolean: CFBooleanRef) -> u8;
}

#[link(name = "CoreVideo", kind = "framework")]
extern "C" {
    static kCVPixelBufferPixelFormatTypeKey: CFStringRef;
    static kCVPixelBufferWidthKey: CFStringRef;
    static kCVPixelBufferHeightKey: CFStringRef;
    static kCVPixelBufferIOSurfacePropertiesKey: CFStringRef;
    static kCVImageBufferColorPrimariesKey: CFStringRef;
    static kCVImageBufferColorPrimaries_ITU_R_709_2: CFStringRef;
    static kCVImageBufferTransferFunctionKey: CFStringRef;
    static kCVImageBufferTransferFunction_ITU_R_709_2: CFStringRef;
    static kCVImageBufferYCbCrMatrixKey: CFStringRef;
    static kCVImageBufferYCbCrMatrix_ITU_R_709_2: CFStringRef;
    fn CVPixelBufferPoolCreatePixelBuffer(
        allocator: CFAllocatorRef,
        pool: CVPixelBufferPoolRef,
        out: *mut CVPixelBufferRef,
    ) -> i32;
    fn CVPixelBufferLockBaseAddress(buffer: CVPixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferUnlockBaseAddress(buffer: CVPixelBufferRef, flags: u64) -> i32;
    fn CVPixelBufferGetBaseAddressOfPlane(buffer: CVPixelBufferRef, plane: usize) -> *mut c_void;
    fn CVPixelBufferGetBytesPerRowOfPlane(buffer: CVPixelBufferRef, plane: usize) -> usize;
    fn CVBufferSetAttachment(
        buffer: CVPixelBufferRef,
        key: CFStringRef,
        value: CFTypeRef,
        mode: u32,
    );
}

#[link(name = "CoreMedia", kind = "framework")]
extern "C" {
    static kCMSampleAttachmentKey_NotSync: CFStringRef;
    fn CMSampleBufferGetDataBuffer(sample: CMSampleBufferRef) -> CMBlockBufferRef;
    fn CMBlockBufferGetDataLength(block: CMBlockBufferRef) -> usize;
    fn CMBlockBufferCopyDataBytes(
        block: CMBlockBufferRef,
        offset: usize,
        len: usize,
        dest: *mut c_void,
    ) -> OSStatus;
    fn CMSampleBufferGetFormatDescription(sample: CMSampleBufferRef) -> CMFormatDescriptionRef;
    fn CMSampleBufferGetSampleAttachmentsArray(sample: CMSampleBufferRef, create: u8)
        -> CFArrayRef;
    fn CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
        desc: CMFormatDescriptionRef,
        index: usize,
        ptr_out: *mut *const u8,
        size_out: *mut usize,
        count_out: *mut usize,
        nal_header_length_out: *mut i32,
    ) -> OSStatus;
}

#[link(name = "VideoToolbox", kind = "framework")]
extern "C" {
    static kVTCompressionPropertyKey_RealTime: CFStringRef;
    static kVTCompressionPropertyKey_ProfileLevel: CFStringRef;
    static kVTCompressionPropertyKey_AverageBitRate: CFStringRef;
    static kVTCompressionPropertyKey_MaxKeyFrameInterval: CFStringRef;
    static kVTCompressionPropertyKey_AllowFrameReordering: CFStringRef;
    static kVTCompressionPropertyKey_ExpectedFrameRate: CFStringRef;
    static kVTCompressionPropertyKey_ColorPrimaries: CFStringRef;
    static kVTCompressionPropertyKey_TransferFunction: CFStringRef;
    static kVTCompressionPropertyKey_YCbCrMatrix: CFStringRef;
    static kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder: CFStringRef;
    static kVTProfileLevel_H264_High_AutoLevel: CFStringRef;
    static kVTEncodeFrameOptionKey_ForceKeyFrame: CFStringRef;
    static kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder: CFStringRef;
    fn VTCompressionSessionCreate(
        allocator: CFAllocatorRef,
        width: i32,
        height: i32,
        codec_type: u32,
        encoder_specification: CFDictionaryRef,
        source_image_buffer_attributes: CFDictionaryRef,
        compressed_data_allocator: CFAllocatorRef,
        output_callback: OutputCallback,
        output_callback_refcon: *mut c_void,
        session_out: *mut VTCompressionSessionRef,
    ) -> OSStatus;
    fn VTSessionSetProperty(
        session: VTCompressionSessionRef,
        key: CFStringRef,
        value: CFTypeRef,
    ) -> OSStatus;
    fn VTSessionCopyProperty(
        session: VTCompressionSessionRef,
        key: CFStringRef,
        allocator: CFAllocatorRef,
        value_out: *mut CFTypeRef,
    ) -> OSStatus;
    fn VTCompressionSessionPrepareToEncodeFrames(session: VTCompressionSessionRef) -> OSStatus;
    fn VTCompressionSessionGetPixelBufferPool(
        session: VTCompressionSessionRef,
    ) -> CVPixelBufferPoolRef;
    fn VTCompressionSessionEncodeFrame(
        session: VTCompressionSessionRef,
        image_buffer: CVPixelBufferRef,
        pts: CMTime,
        duration: CMTime,
        frame_properties: CFDictionaryRef,
        source_frame_refcon: *mut c_void,
        info_flags_out: *mut u32,
    ) -> OSStatus;
    fn VTCompressionSessionCompleteFrames(
        session: VTCompressionSessionRef,
        until: CMTime,
    ) -> OSStatus;
    fn VTCompressionSessionInvalidate(session: VTCompressionSessionRef);
}

/// A CF object released on drop.
struct Owned(CFTypeRef);

impl Drop for Owned {
    fn drop(&mut self) {
        if !self.0.is_null() {
            unsafe { CFRelease(self.0) };
        }
    }
}

fn number_i32(v: i32) -> Owned {
    Owned(unsafe {
        CFNumberCreate(
            ptr::null(),
            K_CFNUMBER_SINT32_TYPE,
            &v as *const i32 as *const c_void,
        )
    })
}

fn number_f64(v: f64) -> Owned {
    Owned(unsafe {
        CFNumberCreate(
            ptr::null(),
            K_CFNUMBER_FLOAT64_TYPE,
            &v as *const f64 as *const c_void,
        )
    })
}

fn dictionary(pairs: &[(CFStringRef, CFTypeRef)]) -> Owned {
    let keys: Vec<CFTypeRef> = pairs.iter().map(|(k, _)| *k).collect();
    let values: Vec<CFTypeRef> = pairs.iter().map(|(_, v)| *v).collect();
    Owned(unsafe {
        CFDictionaryCreate(
            ptr::null(),
            keys.as_ptr(),
            values.as_ptr(),
            pairs.len() as isize,
            &kCFTypeDictionaryKeyCallBacks,
            &kCFTypeDictionaryValueCallBacks,
        )
    })
}

fn check(status: OSStatus, what: &str) -> Result<()> {
    if status == 0 {
        Ok(())
    } else {
        Err(anyhow!("VideoToolbox: {what} failed (OSStatus {status})"))
    }
}

/// What the output callback hands back, in order.
#[derive(Default)]
struct Sink {
    frames: Vec<EncodedVideo>,
    error: Option<String>,
    params_sent: bool,
}

pub struct VtEncoder {
    session: VTCompressionSessionRef,
    sink: Arc<Mutex<Sink>>,
    /// The raw pointer the callback receives; it owns one strong count of `sink`.
    refcon: *const Mutex<Sink>,
    width: usize,
    height: usize,
    fps: f64,
    hardware: bool,
    force_key: Owned,
}

// The session is used from one thread at a time; VideoToolbox's own threads only touch the sink.
unsafe impl Send for VtEncoder {}

extern "C" fn on_output(
    refcon: *mut c_void,
    _source_frame_refcon: *mut c_void,
    status: OSStatus,
    info_flags: u32,
    sample: CMSampleBufferRef,
) {
    let sink = unsafe { &*(refcon as *const Mutex<Sink>) };
    let mut sink = match sink.lock() {
        Ok(s) => s,
        Err(p) => p.into_inner(),
    };
    if status != 0 {
        sink.error
            .get_or_insert(format!("encoding a frame failed (OSStatus {status})"));
        return;
    }
    if sample.is_null() || info_flags & K_VTENCODE_INFO_FRAME_DROPPED != 0 {
        sink.error
            .get_or_insert("the encoder dropped a frame".into());
        return;
    }
    match unsafe { read_sample(sample, !sink.params_sent) } {
        Ok(frame) => {
            if frame.params.is_some() {
                sink.params_sent = true;
            }
            sink.frames.push(frame);
        }
        Err(e) => {
            sink.error.get_or_insert(e.to_string());
        }
    }
}

unsafe fn read_sample(sample: CMSampleBufferRef, want_params: bool) -> Result<EncodedVideo> {
    let block = CMSampleBufferGetDataBuffer(sample);
    if block.is_null() {
        bail!("encoded frame has no data");
    }
    let len = CMBlockBufferGetDataLength(block);
    let mut avcc = vec![0u8; len];
    check(
        CMBlockBufferCopyDataBytes(block, 0, len, avcc.as_mut_ptr() as *mut c_void),
        "reading a frame",
    )?;

    let mut sync = true;
    let attachments = CMSampleBufferGetSampleAttachmentsArray(sample, 0);
    if !attachments.is_null() && CFArrayGetCount(attachments) > 0 {
        let dict = CFArrayGetValueAtIndex(attachments, 0);
        let not_sync = CFDictionaryGetValue(dict, kCMSampleAttachmentKey_NotSync);
        if !not_sync.is_null() && CFBooleanGetValue(not_sync) != 0 {
            sync = false;
        }
    }

    let params = if want_params || sync {
        let desc = CMSampleBufferGetFormatDescription(sample);
        let mut sets: Vec<Vec<u8>> = Vec::new();
        let mut count = 0usize;
        let mut header = 0i32;
        let mut index = 0usize;
        loop {
            let mut p: *const u8 = ptr::null();
            let mut size = 0usize;
            let status = CMVideoFormatDescriptionGetH264ParameterSetAtIndex(
                desc,
                index,
                &mut p,
                &mut size,
                &mut count,
                &mut header,
            );
            if status != 0 || p.is_null() {
                break;
            }
            sets.push(std::slice::from_raw_parts(p, size).to_vec());
            index += 1;
            if index >= count {
                break;
            }
        }
        if header != 4 && !sets.is_empty() {
            bail!("unexpected NAL length size {header}");
        }
        let sps = sets
            .iter()
            .find(|s| s.first().map(|b| b & 0x1F) == Some(7))
            .cloned();
        let pps = sets
            .iter()
            .find(|s| s.first().map(|b| b & 0x1F) == Some(8))
            .cloned();
        match (sps, pps) {
            (Some(sps), Some(pps)) => Some((sps, pps)),
            _ if want_params => bail!("the first frame came without SPS/PPS"),
            _ => None,
        }
    } else {
        None
    };

    Ok(EncodedVideo { avcc, sync, params })
}

impl VtEncoder {
    /// Opens a hardware H.264 session (Apple's software encoder if there is no media engine).
    pub fn new(
        width: u32,
        height: u32,
        fps: f64,
        bitrate: u32,
        keyframe_interval: usize,
    ) -> Result<Self> {
        unsafe {
            let spec = dictionary(&[(
                kVTVideoEncoderSpecification_EnableHardwareAcceleratedVideoEncoder,
                kCFBooleanTrue,
            )]);
            let format = number_i32(K_CVPIXEL_FORMAT_TYPE_420V as i32);
            let w = number_i32(width as i32);
            let h = number_i32(height as i32);
            let iosurface = dictionary(&[]);
            let source = dictionary(&[
                (kCVPixelBufferPixelFormatTypeKey, format.0),
                (kCVPixelBufferWidthKey, w.0),
                (kCVPixelBufferHeightKey, h.0),
                (kCVPixelBufferIOSurfacePropertiesKey, iosurface.0),
            ]);

            let sink = Arc::new(Mutex::new(Sink::default()));
            let refcon = Arc::into_raw(sink.clone());
            let mut session: VTCompressionSessionRef = ptr::null_mut();
            let status = VTCompressionSessionCreate(
                ptr::null(),
                width as i32,
                height as i32,
                K_CMVIDEO_CODEC_TYPE_H264,
                spec.0,
                source.0,
                ptr::null(),
                on_output,
                refcon as *mut c_void,
                &mut session,
            );
            if status != 0 || session.is_null() {
                drop(Arc::from_raw(refcon));
                bail!("VideoToolbox: creating an H.264 session failed (OSStatus {status})");
            }
            let mut enc = Self {
                session,
                sink,
                refcon,
                width: width as usize,
                height: height as usize,
                fps,
                hardware: false,
                force_key: dictionary(&[(kVTEncodeFrameOptionKey_ForceKeyFrame, kCFBooleanTrue)]),
            };

            let bitrate = number_i32(bitrate.min(i32::MAX as u32) as i32);
            let interval = number_i32(keyframe_interval.max(1) as i32);
            let rate = number_f64(fps);
            let props: [(CFStringRef, CFTypeRef, &str); 9] = [
                (
                    kVTCompressionPropertyKey_RealTime,
                    kCFBooleanFalse,
                    "RealTime",
                ),
                (
                    kVTCompressionPropertyKey_ProfileLevel,
                    kVTProfileLevel_H264_High_AutoLevel,
                    "ProfileLevel",
                ),
                (
                    kVTCompressionPropertyKey_AverageBitRate,
                    bitrate.0,
                    "AverageBitRate",
                ),
                (
                    kVTCompressionPropertyKey_MaxKeyFrameInterval,
                    interval.0,
                    "MaxKeyFrameInterval",
                ),
                (
                    kVTCompressionPropertyKey_AllowFrameReordering,
                    kCFBooleanFalse,
                    "AllowFrameReordering",
                ),
                (
                    kVTCompressionPropertyKey_ExpectedFrameRate,
                    rate.0,
                    "ExpectedFrameRate",
                ),
                (
                    kVTCompressionPropertyKey_ColorPrimaries,
                    kCVImageBufferColorPrimaries_ITU_R_709_2,
                    "ColorPrimaries",
                ),
                (
                    kVTCompressionPropertyKey_TransferFunction,
                    kCVImageBufferTransferFunction_ITU_R_709_2,
                    "TransferFunction",
                ),
                (
                    kVTCompressionPropertyKey_YCbCrMatrix,
                    kCVImageBufferYCbCrMatrix_ITU_R_709_2,
                    "YCbCrMatrix",
                ),
            ];
            for (key, value, name) in props {
                check(
                    VTSessionSetProperty(session, key, value),
                    &format!("setting {name}"),
                )?;
            }
            check(
                VTCompressionSessionPrepareToEncodeFrames(session),
                "preparing the session",
            )?;

            let mut using: CFTypeRef = ptr::null();
            if VTSessionCopyProperty(
                session,
                kVTCompressionPropertyKey_UsingHardwareAcceleratedVideoEncoder,
                ptr::null(),
                &mut using,
            ) == 0
                && !using.is_null()
            {
                enc.hardware = CFBooleanGetValue(using) != 0;
                CFRelease(using);
            }
            Ok(enc)
        }
    }

    /// True when the frames go to the media engine rather than Apple's software encoder.
    pub fn is_hardware(&self) -> bool {
        self.hardware
    }

    /// Queues one RGBA frame and returns the frames that finished meanwhile (in order).
    pub fn encode(
        &mut self,
        rgba: &[u8],
        index: usize,
        keyframe: bool,
    ) -> Result<Vec<EncodedVideo>> {
        unsafe {
            let pool = VTCompressionSessionGetPixelBufferPool(self.session);
            if pool.is_null() {
                bail!("VideoToolbox: the session has no pixel buffer pool");
            }
            let mut buffer: CVPixelBufferRef = ptr::null_mut();
            if CVPixelBufferPoolCreatePixelBuffer(ptr::null(), pool, &mut buffer) != 0
                || buffer.is_null()
            {
                bail!("VideoToolbox: could not get a pixel buffer");
            }
            let buffer_owned = Owned(buffer as CFTypeRef);
            check(
                CVPixelBufferLockBaseAddress(buffer, 0),
                "locking a pixel buffer",
            )?;
            let y_base = CVPixelBufferGetBaseAddressOfPlane(buffer, 0) as *mut u8;
            let uv_base = CVPixelBufferGetBaseAddressOfPlane(buffer, 1) as *mut u8;
            let y_stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 0);
            let uv_stride = CVPixelBufferGetBytesPerRowOfPlane(buffer, 1);
            if y_base.is_null()
                || uv_base.is_null()
                || y_stride < self.width
                || uv_stride < self.width
            {
                CVPixelBufferUnlockBaseAddress(buffer, 0);
                bail!("VideoToolbox: pixel buffer is smaller than the frame");
            }
            let y_plane = std::slice::from_raw_parts_mut(y_base, y_stride * self.height);
            let uv_plane = std::slice::from_raw_parts_mut(uv_base, uv_stride * (self.height / 2));
            rgba_to_nv12_709(
                rgba,
                self.width,
                self.height,
                y_plane,
                y_stride,
                uv_plane,
                uv_stride,
            );
            CVPixelBufferUnlockBaseAddress(buffer, 0);
            CVBufferSetAttachment(
                buffer,
                kCVImageBufferColorPrimariesKey,
                kCVImageBufferColorPrimaries_ITU_R_709_2,
                K_CVATTACHMENT_MODE_SHOULD_PROPAGATE,
            );
            CVBufferSetAttachment(
                buffer,
                kCVImageBufferTransferFunctionKey,
                kCVImageBufferTransferFunction_ITU_R_709_2,
                K_CVATTACHMENT_MODE_SHOULD_PROPAGATE,
            );
            CVBufferSetAttachment(
                buffer,
                kCVImageBufferYCbCrMatrixKey,
                kCVImageBufferYCbCrMatrix_ITU_R_709_2,
                K_CVATTACHMENT_MODE_SHOULD_PROPAGATE,
            );

            // timestamps in 1/90000 s, like the MP4 track
            let timescale = super::encoder::VIDEO_TIMESCALE as i32;
            let pts = CMTime {
                value: (index as f64 * timescale as f64 / self.fps).round() as i64,
                timescale,
                flags: CMTIME_VALID,
                epoch: 0,
            };
            let duration = CMTime {
                value: (timescale as f64 / self.fps).round() as i64,
                timescale,
                flags: CMTIME_VALID,
                epoch: 0,
            };
            let props = if keyframe {
                self.force_key.0
            } else {
                ptr::null()
            };
            let mut flags = 0u32;
            let status = VTCompressionSessionEncodeFrame(
                self.session,
                buffer,
                pts,
                duration,
                props,
                ptr::null_mut(),
                &mut flags,
            );
            drop(buffer_owned);
            check(status, "encoding a frame")?;
        }
        self.drain()
    }

    /// Waits for every queued frame and returns the rest.
    pub fn finish(&mut self) -> Result<Vec<EncodedVideo>> {
        check(
            unsafe { VTCompressionSessionCompleteFrames(self.session, CMTIME_INVALID) },
            "finishing the stream",
        )?;
        self.drain()
    }

    fn drain(&mut self) -> Result<Vec<EncodedVideo>> {
        let mut sink = self
            .sink
            .lock()
            .map_err(|_| anyhow!("VideoToolbox: output lock poisoned"))?;
        if let Some(e) = sink.error.take() {
            bail!("VideoToolbox: {e}");
        }
        Ok(std::mem::take(&mut sink.frames))
    }
}

impl Drop for VtEncoder {
    fn drop(&mut self) {
        unsafe {
            VTCompressionSessionInvalidate(self.session);
            CFRelease(self.session as CFTypeRef);
            // the session no longer calls back, so its count on the sink can go
            drop(Arc::from_raw(self.refcon));
        }
    }
}

/// RGBA to NV12 (BT.709, limited range), split into bands of rows across the cores.
pub fn rgba_to_nv12_709(
    rgba: &[u8],
    width: usize,
    height: usize,
    y_plane: &mut [u8],
    y_stride: usize,
    uv_plane: &mut [u8],
    uv_stride: usize,
) {
    let pairs = height / 2; // rows of the UV plane
    let threads = std::thread::available_parallelism()
        .map(|n| n.get())
        .unwrap_or(4)
        .clamp(1, 8);
    let per = pairs.div_ceil(threads).max(1);
    std::thread::scope(|scope| {
        let mut y_rest = y_plane;
        let mut uv_rest = uv_plane;
        let mut first = 0;
        while first < pairs {
            let n = per.min(pairs - first);
            let (y_band, y_tail) = std::mem::take(&mut y_rest).split_at_mut(n * 2 * y_stride);
            y_rest = y_tail;
            let (uv_band, uv_tail) = std::mem::take(&mut uv_rest).split_at_mut(n * uv_stride);
            uv_rest = uv_tail;
            let src = &rgba[first * 2 * width * 4..(first + n) * 2 * width * 4];
            scope.spawn(move || convert_band(src, width, n, y_band, y_stride, uv_band, uv_stride));
            first += n;
        }
    });
}

/// `pairs` pairs of RGBA rows into Y rows and interleaved CbCr rows.
fn convert_band(
    rgba: &[u8],
    width: usize,
    pairs: usize,
    y_plane: &mut [u8],
    y_stride: usize,
    uv_plane: &mut [u8],
    uv_stride: usize,
) {
    // BT.709 studio swing, 8-bit fixed point (x256)
    let luma = |r: i32, g: i32, b: i32| {
        (16 + ((47 * r + 157 * g + 16 * b + 128) >> 8)).clamp(16, 235) as u8
    };
    let row_bytes = width * 4;
    for j in 0..pairs {
        let top = &rgba[2 * j * row_bytes..(2 * j + 1) * row_bytes];
        let bottom = &rgba[(2 * j + 1) * row_bytes..(2 * j + 2) * row_bytes];
        let (y0, y1) = y_plane[2 * j * y_stride..(2 * j + 2) * y_stride].split_at_mut(y_stride);
        let uv = &mut uv_plane[j * uv_stride..j * uv_stride + width];
        for i in 0..width / 2 {
            let a = &top[i * 8..i * 8 + 8];
            let c = &bottom[i * 8..i * 8 + 8];
            let px = |p: &[u8], k: usize| (p[k] as i32, p[k + 1] as i32, p[k + 2] as i32);
            let (r00, g00, b00) = px(a, 0);
            let (r01, g01, b01) = px(a, 4);
            let (r10, g10, b10) = px(c, 0);
            let (r11, g11, b11) = px(c, 4);
            y0[2 * i] = luma(r00, g00, b00);
            y0[2 * i + 1] = luma(r01, g01, b01);
            y1[2 * i] = luma(r10, g10, b10);
            y1[2 * i + 1] = luma(r11, g11, b11);
            let r = (r00 + r01 + r10 + r11 + 2) >> 2;
            let g = (g00 + g01 + g10 + g11 + 2) >> 2;
            let b = (b00 + b01 + b10 + b11 + 2) >> 2;
            uv[2 * i] = (128 + ((-26 * r - 86 * g + 112 * b + 128) >> 8)).clamp(16, 240) as u8;
            uv[2 * i + 1] = (128 + ((112 * r - 102 * g - 10 * b + 128) >> 8)).clamp(16, 240) as u8;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_rgba_to_bt709_nv12_with_padded_rows() {
        let (w, h) = (6usize, 10usize);
        let mut rgba = vec![255u8; w * h * 4];
        for (i, px) in rgba.chunks_exact_mut(4).enumerate() {
            // white on the left half, (200, 60, 30) on the right
            if i % w >= w / 2 {
                px[..3].copy_from_slice(&[200, 60, 30]);
            }
        }
        let (ys, uvs) = (8usize, 16usize);
        let mut y = vec![0u8; ys * h];
        let mut uv = vec![0u8; uvs * h / 2];
        rgba_to_nv12_709(&rgba, w, h, &mut y, ys, &mut uv, uvs);
        for row in 0..h {
            assert_eq!(
                &y[row * ys..row * ys + w],
                &[235, 235, 235, 91, 91, 91],
                "row {row}"
            );
            assert_eq!(
                &y[row * ys + w..(row + 1) * ys],
                &[0, 0],
                "padding untouched"
            );
        }
        for row in 0..h / 2 {
            let line = &uv[row * uvs..row * uvs + w];
            assert_eq!(&line[..2], &[128, 128], "white has no chroma");
            // (200, 60, 30) in BT.709 is Cb 100.7, Cr 190.6; 8-bit fixed point may be one off
            assert!(
                line[4].abs_diff(101) <= 1 && line[5].abs_diff(191) <= 1,
                "CbCr {:?}",
                &line[4..6]
            );
        }
    }
}
