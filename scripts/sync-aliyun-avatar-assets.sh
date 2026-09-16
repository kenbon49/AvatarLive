#!/usr/bin/env bash

set -euo pipefail

manifest_path="${1:-/tmp/aliyun-public-avatars.json}"
output_root="${2:-public/assets/aliyun-avatars}"
worker_count="${ALIYUN_AVATAR_SYNC_WORKERS:-4}"
video_mode="${ALIYUN_AVATAR_VIDEO_MODE:-original}"
force_videos="${ALIYUN_AVATAR_FORCE_VIDEOS:-0}"
force_covers="${ALIYUN_AVATAR_FORCE_COVERS:-0}"

if [[ ! -f "$manifest_path" ]]; then
  echo "Manifest not found: $manifest_path" >&2
  exit 1
fi

if [[ "$video_mode" != "original" && "$video_mode" != "compact" ]]; then
  echo "ALIYUN_AVATAR_VIDEO_MODE must be original or compact." >&2
  exit 1
fi

mkdir -p "$output_root/covers" "$output_root/videos"
sync_temp_dir="$(mktemp -d /tmp/aliyun-avatar-sync.XXXXXX)"
trap 'rm -rf "$sync_temp_dir"' EXIT

sync_avatar() {
  local id="$1"
  local transparent="$2"
  local cover_path="$3"
  local video_path="$4"
  local cover_output="$output_root/covers/$id.webp"
  local legacy_transparent_cover="$output_root/covers/$id.png"
  local video_output="$output_root/videos/$id.mp4"
  local worker_temp="$sync_temp_dir/$id"

  mkdir -p "$worker_temp"

  if [[ ! -s "$cover_output" || "$force_covers" == "1" ]]; then
    if [[ "$transparent" == "true" && -s "$legacy_transparent_cover" && "$force_covers" != "1" ]]; then
      cp "$legacy_transparent_cover" "$worker_temp/cover"
    else
      curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
        "https:$cover_path" -o "$worker_temp/cover"
    fi
    if [[ "$transparent" == "true" ]]; then
      local pixel_format
      pixel_format="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$worker_temp/cover")"
      if [[ "$pixel_format" != "rgba" && "$pixel_format" != "bgra" && "$pixel_format" != "ya8" && "$pixel_format" != "pal8" ]]; then
        echo "Transparent cover has no alpha-capable pixel format: $id ($pixel_format)" >&2
        return 1
      fi
      ffmpeg -hide_banner -loglevel error -y -i "$worker_temp/cover" \
        -vf "scale='min(1080,iw)':'min(1920,ih)':force_original_aspect_ratio=decrease" \
        -frames:v 1 -c:v libwebp -quality 88 -compression_level 6 -pix_fmt yuva420p "$cover_output"
      pixel_format="$(ffprobe -v error -select_streams v:0 -show_entries stream=pix_fmt -of default=noprint_wrappers=1:nokey=1 "$cover_output")"
      if [[ "$pixel_format" != "yuva420p" ]]; then
        echo "Optimized transparent cover lost its alpha-capable format: $id ($pixel_format)" >&2
        return 1
      fi
    else
      ffmpeg -hide_banner -loglevel error -y -i "$worker_temp/cover" \
        -vf "scale=540:-2:force_original_aspect_ratio=decrease" \
        -frames:v 1 -c:v libwebp -quality 80 "$cover_output"
    fi
    ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
      -of csv=p=0 "$cover_output" >/dev/null
  fi

  if [[ -n "$video_path" && ( ! -s "$video_output" || "$force_videos" == "1" ) ]]; then
    curl --fail --silent --show-error --location --retry 3 --retry-all-errors \
      "https:$video_path" -o "$worker_temp/video"
    ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
      -of csv=p=0 "$worker_temp/video" >/dev/null
    if [[ "$video_mode" == "original" ]]; then
      mv -f "$worker_temp/video" "$video_output"
    else
      ffmpeg -hide_banner -loglevel error -y -i "$worker_temp/video" \
        -vf "scale=540:-2:force_original_aspect_ratio=decrease,fps=24" \
        -c:v libx264 -preset veryfast -crf 29 -pix_fmt yuv420p \
        -c:a aac -b:a 64k -movflags +faststart "$video_output"
    fi
    ffprobe -v error -select_streams v:0 -show_entries stream=width,height \
      -of csv=p=0 "$video_output" >/dev/null
  fi

  rm -rf "$worker_temp"
  echo "$id"
}

export output_root sync_temp_dir video_mode force_videos force_covers
export -f sync_avatar

jq -r '.[] | @base64' "$manifest_path" \
  | xargs -P "$worker_count" -n 1 bash -euo pipefail -c '
      record="$(printf "%s" "$1" | base64 --decode)"
      id="$(jq -r ".id" <<<"$record")"
      transparent="$(jq -r ".transparent == true" <<<"$record")"
      cover_path="$(jq -r "if .transparent == true then .coverURL else .displayCoverURL end" <<<"$record")"
      video_path="$(jq -r ".displayVideoURL // empty" <<<"$record")"
      sync_avatar "$id" "$transparent" "$cover_path" "$video_path"
    ' _

expected_cover_count="$(jq 'length' "$manifest_path")"
expected_video_count="$(jq '[.[] | select(.displayVideoURL != null)] | length' "$manifest_path")"
missing_cover_count=0
while IFS=$'\t' read -r id transparent; do
  if [[ ! -s "$output_root/covers/$id.webp" ]]; then
    missing_cover_count=$((missing_cover_count + 1))
  fi
done < <(jq -r '.[] | [.id, (.transparent == true)] | @tsv' "$manifest_path")
actual_cover_count=$((expected_cover_count - missing_cover_count))
actual_video_count="$(find "$output_root/videos" -maxdepth 1 -type f -name '*.mp4' | wc -l)"

if [[ "$actual_cover_count" -ne "$expected_cover_count" || "$actual_video_count" -ne "$expected_video_count" ]]; then
  echo "Asset count mismatch: covers $actual_cover_count/$expected_cover_count, videos $actual_video_count/$expected_video_count" >&2
  exit 1
fi

echo "Synchronized $actual_cover_count covers and $actual_video_count videos."
