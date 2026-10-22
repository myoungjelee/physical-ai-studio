import { useEffect } from 'react';

import { SchemaEpisode } from '../../../api/openapi-spec';
import { clamp, getFrameAt, getFullTrimRange, TrimRange, withTrimEnd, withTrimStart } from './trim-range';
import { Player } from './use-player';

const IGNORED_TARGETS = 'input, textarea, select, button, [contenteditable], [role="dialog"], [role="alertdialog"]';

interface UseTrimShortcutsProps {
    episode: SchemaEpisode;
    player: Player;
    setRange: (range: TrimRange) => void;
    range: TrimRange;
    seek: (time: number) => void;
}

/**
 * space: play/pause · , and .: step a frame (shift: ten) · [ and ]: set in/out at the playhead ·
 * backslash: keep everything.
 */
export const useTrimShortcuts = ({ episode, player, range, setRange, seek }: UseTrimShortcutsProps) => {
    useEffect(() => {
        const onKeyDown = (event: KeyboardEvent) => {
            const isIgnored = event.target instanceof Element && event.target.closest(IGNORED_TARGETS) !== null;
            if (isIgnored || event.metaKey || event.ctrlKey || event.altKey) return;

            const { fps, length } = episode;
            const frame = getFrameAt(player.timeRef.current, fps, length);

            switch (event.key) {
                case ' ':
                    event.preventDefault();
                    if (player.isPlaying) player.pause();
                    else player.play();
                    break;
                case ',':
                case '.': {
                    const step = (event.key === '.' ? 1 : -1) * (event.shiftKey ? 10 : 1);
                    player.pause();
                    seek(clamp(frame + step, 0, length - 1) / fps);
                    break;
                }
                case '[':
                    setRange(withTrimStart(range, frame));
                    break;
                case ']':
                    setRange(withTrimEnd(range, frame + 1, length));
                    break;
                case '\\':
                    setRange(getFullTrimRange(length));
                    break;
            }
        };

        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });
};
