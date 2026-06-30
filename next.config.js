/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverActions: {
      bodySizeLimit: "20mb",
    },
  },
  // The static ffmpeg binary (used by /api/analyze to transcode recordings to
  // MP3) isn't auto-detected by output file tracing, so include it explicitly
  // for that route's serverless bundle. The glob covers whichever platform
  // binary ffmpeg-static installed (e.g. `ffmpeg` on Vercel's Linux build).
  outputFileTracingIncludes: {
    "/api/analyze": ["./node_modules/ffmpeg-static/**"],
  },
};

module.exports = nextConfig;
