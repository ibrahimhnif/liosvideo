<script lang="ts">
  let { size = 20, class: className = "" }: { size?: number; class?: string } = $props();
</script>

<svg
  xmlns="http://www.w3.org/2000/svg"
  viewBox="0 0 100 100"
  width={size}
  height={size}
  class="liosvideo-logo {className}"
  aria-label="Liosvideo logo"
>
  <rect
    name="plate"
    x="2"
    y="2"
    width="96"
    height="96"
    rx="26"
    ry="26"
    fill="#16161e"
    stroke="#7aa2f7"
    stroke-width="3"
  />
  <path
    name="playGlyph"
    d="M 40 30 L 72 50 L 40 70 Z"
    fill="#7aa2f7"
  />
  <circle
    name="sparkDot"
    cx="80"
    cy="20"
    r="5"
    fill="#9ece6a"
  />
</svg>

<style>
  .liosvideo-logo {
    display: inline-block;
    vertical-align: middle;
    flex-shrink: 0;
  }
</style>
