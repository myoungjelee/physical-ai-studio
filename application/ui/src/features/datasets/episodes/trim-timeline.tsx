import { ReactNode, useMemo, useRef, useState } from 'react';

import { ActionButton, AlertDialog, Button, DialogTrigger, toast, Tooltip, TooltipTrigger } from '@geti-ui/ui';
import { Pause, Play } from '@geti-ui/ui/icons';

import { getApiErrorMessage } from '../../../api/errors';
import { SchemaEpisode } from '../../../api/openapi-spec';
import {
    canSubmitTrim,
    clamp,
    formatTrimRangeLabel,
    getFrameAt,
    getFullTrimRange,
    suggestTrimRange,
    TrimRange,
    withTrimEnd,
    withTrimStart,
} from './trim-range';
import {
    getExtent,
    getJointSeries,
    getMotion,
    GRIPPER_COLOR,
    toPolylinePoints,
    TRACK_HEIGHT,
    TRACK_WIDTH,
} from './trim-timeline-data';
import { useTrimEpisodeQuery } from './use-episodes';
import { useFilmstrip } from './use-filmstrip';
import { Player } from './use-player';
import { usePlayerTime } from './use-player-time';
import { useTrimDrag } from './use-trim-drag';
import { useTrimShortcuts } from './use-trim-shortcuts';

import classes from './trim-timeline.module.css';

const FILMSTRIP_THUMBNAILS = 16;

const formatSeconds = (seconds: number) => `${seconds.toFixed(2)}s`;
const toPercent = (frame: number, length: number) => `${(frame / length) * 100}%`;

interface TrackProps {
    label: string;
    height: number;
    children: ReactNode;
}

const Track = ({ label, height, children }: TrackProps) => (
    <div className={classes.track} style={{ height }}>
        <span className={classes.trackLabel}>{label}</span>
        <svg className={classes.trackSvg} viewBox={`0 0 ${TRACK_WIDTH} ${TRACK_HEIGHT}`} preserveAspectRatio='none'>
            {children}
        </svg>
    </div>
);

interface TrimTimelineProps {
    datasetId: string;
    episode: SchemaEpisode;
    player: Player;
}

export const TrimTimeline = ({ datasetId, episode, player }: TrimTimelineProps) => {
    const { length, fps } = episode;
    const duration = length / fps;

    const [range, setRange] = useState<TrimRange>(() => getFullTrimRange(length));
    const { time, seek } = usePlayerTime(player);
    const { isPending, trimEpisode } = useTrimEpisodeQuery(datasetId, episode.episode_index);
    const trackRef = useRef<HTMLDivElement>(null);

    const currentFrame = getFrameAt(time, fps, length);
    const kept = range.end - range.start;
    const removedSeconds = (length - kept) / fps;

    const series = useMemo(() => getJointSeries(episode), [episode]);
    const armSeries = series.filter(({ isGripper }) => !isGripper);
    const gripper = series.find(({ isGripper }) => isGripper);
    const armExtent = useMemo(() => getExtent(armSeries.flatMap(({ values }) => values)), [armSeries]);
    const motion = useMemo(() => getMotion(series, length), [series, length]);
    const motionPoints = useMemo(() => toPolylinePoints(motion, getExtent(motion)), [motion]);
    const filmstrip = useFilmstrip(datasetId, episode, FILMSTRIP_THUMBNAILS);

    const drag = useTrimDrag({ trackRef, episode, player, range, setRange, seek });
    useTrimShortcuts({ episode, player, range, setRange, seek });

    const hoverFrame = drag.hoverFrame === undefined ? undefined : clamp(drag.hoverFrame, 0, length - 1);
    const tickStep = duration > 60 ? 10 : duration > 20 ? 4 : 2;
    const ticks = Array.from({ length: Math.floor(duration / tickStep) + 1 }, (_, i) => i * tickStep);

    const getPlayheadFrame = () => getFrameAt(player.timeRef.current, fps, length);
    const stepFrame = (step: number) => seek(clamp(getPlayheadFrame() + step, 0, length - 1) / fps);

    const handleSuggest = () => {
        const suggestion = suggestTrimRange(episode.actions, episode.action_keys, fps);
        if (suggestion === undefined) {
            toast.info('No idle frames detected.');
            return;
        }
        setRange(suggestion);
    };

    const handleTrim = async () => {
        try {
            await trimEpisode(range.start, range.end);
            toast.positive('Episode trimmed.');
        } catch (error: unknown) {
            toast.negative(getApiErrorMessage(error) ?? 'Failed to trim episode.');
        }
    };

    return (
        <div className={classes.root}>
            <div className={classes.toolbar}>
                <ActionButton
                    aria-label={player.isPlaying ? 'Pause' : 'Play'}
                    onPress={player.isPlaying ? player.pause : player.play}
                >
                    {player.isPlaying ? <Pause /> : <Play />}
                </ActionButton>
                <ActionButton isQuiet aria-label='Previous frame' onPress={() => stepFrame(-1)}>
                    ‹
                </ActionButton>
                <ActionButton isQuiet aria-label='Next frame' onPress={() => stepFrame(1)}>
                    ›
                </ActionButton>
                <span className={classes.mono}>
                    frame {currentFrame} / {length - 1} · {formatSeconds(time)}
                </span>
                <span className={classes.spacer} />
                <ActionButton onPress={() => setRange(withTrimStart(range, getPlayheadFrame()))}>[ In</ActionButton>
                <ActionButton onPress={() => setRange(withTrimEnd(range, getPlayheadFrame() + 1, length))}>
                    Out ]
                </ActionButton>
                <ActionButton isQuiet onPress={() => setRange(getFullTrimRange(length))}>
                    Full
                </ActionButton>
                <TooltipTrigger>
                    <ActionButton isQuiet onPress={handleSuggest}>
                        Suggest range
                    </ActionButton>
                    <Tooltip>
                        Select frames where the robot is moving, skipping idle frames at the start and end.
                    </Tooltip>
                </TooltipTrigger>
                <span className={classes.mono}>
                    keep {range.start}–{range.end} · {kept}/{length} frames · {formatSeconds(kept / fps)}
                    {removedSeconds > 0 && <span className={classes.removed}> (−{formatSeconds(removedSeconds)})</span>}
                </span>
                <DialogTrigger>
                    <Button
                        variant='accent'
                        isPending={isPending}
                        isDisabled={!canSubmitTrim(range, length) || isPending}
                    >
                        Trim
                    </Button>
                    <AlertDialog
                        title='Trim episode'
                        variant='warning'
                        primaryActionLabel='Trim'
                        cancelLabel='Cancel'
                        isPrimaryActionDisabled={isPending}
                        onPrimaryAction={handleTrim}
                    >
                        Are you sure you want to trim this episode to {formatTrimRangeLabel(range, fps)}? Frames outside
                        this range will be removed from the episode.
                    </AlertDialog>
                </DialogTrigger>
            </div>

            <div className={classes.legend}>
                {armSeries.map(({ key, label, color }) => (
                    <span key={key} className={classes.legendItem}>
                        <i style={{ background: color }} />
                        {label}
                    </span>
                ))}
                {gripper && (
                    <span className={classes.legendItem}>
                        <i style={{ background: GRIPPER_COLOR }} />
                        gripper
                    </span>
                )}
                <span className={classes.hint}>
                    drag orange handles to crop · click to seek · space play · ,/. step · [ ] in/out · \ keep all
                </span>
            </div>

            <div
                ref={trackRef}
                className={classes.tracks}
                onPointerDown={drag.onPointerDown('playhead')}
                onPointerMove={drag.onPointerMove}
                onPointerUp={drag.onPointerUp}
                onPointerLeave={drag.onPointerLeave}
            >
                <div className={classes.filmstrip}>
                    {filmstrip.map((src, i) => (
                        <img key={i} src={src} alt='' draggable={false} />
                    ))}
                </div>
                <div className={classes.ruler}>
                    {ticks.map((tick) => (
                        <span key={tick} style={{ left: `${(tick / duration) * 100}%` }}>
                            {tick}s
                        </span>
                    ))}
                </div>
                <Track label={`joint positions · ${armExtent[0].toFixed(0)} … ${armExtent[1].toFixed(0)}`} height={110}>
                    {armSeries.map(({ key, values, color }) => (
                        <polyline
                            key={key}
                            points={toPolylinePoints(values, armExtent)}
                            fill='none'
                            stroke={color}
                            strokeWidth={1.5}
                            vectorEffect='non-scaling-stroke'
                        />
                    ))}
                </Track>
                {gripper && (
                    <Track label='gripper' height={40}>
                        <polyline
                            points={toPolylinePoints(gripper.values, getExtent(gripper.values))}
                            fill='none'
                            stroke={gripper.color}
                            strokeWidth={1.5}
                            vectorEffect='non-scaling-stroke'
                        />
                    </Track>
                )}
                <Track label='motion — Σ|Δjoint| per frame, near zero means the arm is idle' height={40}>
                    <polygon
                        points={`0,${TRACK_HEIGHT} ${motionPoints} ${TRACK_WIDTH},${TRACK_HEIGHT}`}
                        fill='rgba(220, 220, 220, 0.55)'
                    />
                </Track>

                <div className={classes.dim} style={{ left: 0, width: toPercent(range.start, length) }} />
                <div className={classes.dim} style={{ left: toPercent(range.end, length), right: 0 }} />

                {hoverFrame !== undefined && drag.dragging === undefined && (
                    <div className={classes.hoverLine} style={{ left: toPercent(hoverFrame, length) }}>
                        <div
                            className={classes.tooltip}
                            style={hoverFrame > length * 0.7 ? { left: 'auto', right: 8 } : undefined}
                        >
                            <div className={classes.mono}>
                                frame {hoverFrame} · {formatSeconds(hoverFrame / fps)}
                            </div>
                            {series.map(({ key, label, color, values }) => (
                                <div key={key} className={classes.tooltipRow}>
                                    <i style={{ background: color }} />
                                    <span>{label}</span>
                                    <span className={classes.mono}>{values[hoverFrame].toFixed(1)}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className={classes.playhead} style={{ left: toPercent(time * fps, length) }} />
                {(['start', 'end'] as const).map((edge) => (
                    <div
                        key={edge}
                        className={classes.handle}
                        data-active={drag.dragging === edge}
                        style={{ left: toPercent(range[edge], length) }}
                        onPointerDown={drag.onPointerDown(edge)}
                        onPointerMove={drag.onPointerMove}
                        onPointerUp={drag.onPointerUp}
                    >
                        <span className={classes.knob} />
                    </div>
                ))}
            </div>
        </div>
    );
};
