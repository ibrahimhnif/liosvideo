export interface VoiceRecorderOptions {
  getMediaStream?: () => Promise<MediaStream>;
  createMediaRecorder?: (stream: MediaStream) => MediaRecorder;
  now?: () => number;
}

export interface RecordingResult {
  blob: Blob;
  duration: number;
}

export class VoiceRecorder {
  private mediaRecorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private startTime = 0;
  private getMediaStream: () => Promise<MediaStream>;
  private createMediaRecorder: (stream: MediaStream) => MediaRecorder;
  private now: () => number;

  constructor(opts?: VoiceRecorderOptions) {
    this.getMediaStream = opts?.getMediaStream ?? (() => navigator.mediaDevices.getUserMedia({ audio: true }));
    this.createMediaRecorder = opts?.createMediaRecorder ?? ((s) => new MediaRecorder(s));
    this.now = opts?.now ?? (() => performance.now());
  }

  get isRecording(): boolean {
    return this.mediaRecorder?.state === "recording";
  }

  async start(): Promise<void> {
    if (this.isRecording) return;
    this.chunks = [];
    this.stream = await this.getMediaStream();
    this.mediaRecorder = this.createMediaRecorder(this.stream);

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) {
        this.chunks.push(e.data);
      }
    };

    this.startTime = this.now();
    this.mediaRecorder.start();
  }

  async stop(): Promise<RecordingResult> {
    if (!this.mediaRecorder) {
      throw new Error("Recorder was not started");
    }

    return new Promise<RecordingResult>((resolve, reject) => {
      const durationSec = Math.max(0.1, (this.now() - this.startTime) / 1000);

      this.mediaRecorder!.onstop = () => {
        try {
          const blob = new Blob(this.chunks, { type: "audio/webm" });
          if (this.stream) {
            this.stream.getTracks().forEach((track) => track.stop());
            this.stream = null;
          }
          this.mediaRecorder = null;
          resolve({ blob, duration: durationSec });
        } catch (e) {
          reject(e);
        }
      };

      this.mediaRecorder!.stop();
    });
  }
}
