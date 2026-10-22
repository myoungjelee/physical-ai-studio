import { useEffect, useMemo, useState } from 'react';

import { fetchClient } from '../../../api/client';
import { SchemaEpisode } from '../../../api/openapi-spec';

const THUMBNAIL_HEIGHT = 96;

/** Grabs `count` evenly spaced thumbnails from the episode's slice of its (shared) overview video file. */
export const useFilmstrip = (datasetId: string, episode: SchemaEpisode, count: number) => {
    const [thumbnails, setThumbnails] = useState<string[]>([]);
    const duration = episode.length / episode.fps;

    const source = useMemo(() => {
        const videos = Object.entries(episode.videos);
        const [, video] = videos.find(([key]) => key.includes('overview')) ?? videos[0] ?? [];
        if (video === undefined) return undefined;

        const url = fetchClient.PATH('/api/dataset/{dataset_id}/video/{video_path}', {
            params: { path: { dataset_id: datasetId, video_path: video.path } },
        });
        return { url, start: video.start };
    }, [datasetId, episode.videos]);

    useEffect(() => {
        setThumbnails([]);
        if (source === undefined) return;

        let cancelled = false;
        const video = document.createElement('video');
        video.muted = true;
        video.preload = 'auto';
        video.src = source.url;

        const seekTo = (time: number) =>
            new Promise<void>((resolve) => {
                video.addEventListener('seeked', () => resolve(), { once: true });
                video.currentTime = time;
            });

        const capture = async () => {
            await new Promise<void>((resolve, reject) => {
                video.addEventListener('loadedmetadata', () => resolve(), { once: true });
                video.addEventListener('error', () => reject(new Error('Failed to load video')), { once: true });
            });

            const canvas = document.createElement('canvas');
            canvas.height = THUMBNAIL_HEIGHT;
            canvas.width = Math.round((THUMBNAIL_HEIGHT * video.videoWidth) / Math.max(1, video.videoHeight));
            const context = canvas.getContext('2d');
            if (context === null) return;

            for (let i = 0; i < count && !cancelled; i++) {
                await seekTo(source.start + ((i + 0.5) / count) * duration);
                context.drawImage(video, 0, 0, canvas.width, canvas.height);
                const thumbnail = canvas.toDataURL('image/jpeg', 0.7);
                if (!cancelled) setThumbnails((previous) => [...previous, thumbnail]);
            }
        };

        // The filmstrip is decorative; the tracks below still work when the video cannot be decoded.
        capture().catch(() => undefined);

        return () => {
            cancelled = true;
            video.removeAttribute('src');
            video.load();
        };
    }, [source, duration, count]);

    return thumbnails;
};
