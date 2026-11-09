FROM mwader/static-ffmpeg:7.1.1@sha256:6769881cc02c80d33e387750a8e144d162adfab2775e934dd97899261dda3a0c AS ffmpeg
FROM node:22-bookworm-slim@sha256:aaa4b5baf1ecff3b283486bb1f90405cdda225a3e6f79660d2c559fa510a7292
COPY --from=ffmpeg /ffmpeg /usr/local/bin/ffmpeg
COPY --from=ffmpeg /ffprobe /usr/local/bin/ffprobe
WORKDIR /mudex
COPY app ./app
COPY ui ./ui
EXPOSE 4870
CMD ["node", "app/server.mjs", "--no-open"]
