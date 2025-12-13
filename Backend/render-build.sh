#!/usr/bin/env bash
set -e

echo "Installing yt-dlp..."
pip install --no-cache-dir yt-dlp

echo "Downloading ffmpeg static build..."
curl -L https://johnvansickle.com/ffmpeg/releases/ffmpeg-release-amd64-static.tar.xz \
  | tar -xJ

echo "Setting up ffmpeg locally..."
mkdir -p bin
cp ffmpeg-*-amd64-static/ffmpeg bin/
cp ffmpeg-*-amd64-static/ffprobe bin/

echo "Done: ffmpeg + ffprobe installed locally"
