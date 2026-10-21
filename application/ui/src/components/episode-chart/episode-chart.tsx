import { useCallback, useMemo, useRef, useState } from 'react';

import {
    CartesianGrid,
    Legend,
    Line,
    LineChart,
    ReferenceArea,
    ReferenceLine,
    ResponsiveContainer,
    XAxis,
    YAxis,
    type MouseHandlerDataParam,
} from 'recharts';

import type { TrimRange } from '../../features/datasets/episodes/trim-range';

export const CHART_MARGIN = { top: 20, right: 20, left: 20, bottom: 20 };
export const Y_AXIS_WIDTH = 60;
export const CHART_HEIGHT = 300;

function buildChartData(actions: number[][], joints: string[], fps: number) {
    return actions.map((row, idx) => ({
        index: idx / fps,
        ...joints.reduce((acc, joint, index) => ({ ...acc, [joint]: row[index] }), {}),
    }));
}

const lineColors = ['#ff7300', '#387908', '#8884d8', '#82ca9d', '#ffbb28', '#a83279', '#aaffff'];

function toCapitalizedWords(name: string) {
    const words = name.match(/[A-Za-z][a-z]*/g) || [];

    return words.map(capitalize).join(' ');
}

function capitalize(word: string) {
    return word.charAt(0).toUpperCase() + word.substring(1);
}

function isPosJoint(name: string) {
    return name.endsWith('.pos');
}

function stripPosSuffix(name: string) {
    return name.replace(/\.pos$/, '');
}
interface EpisodeChartProps {
    actions: number[][];
    joints: string[];
    fps: number;
    time: number;
    seek: (time: number) => void;
    play: () => void;
    pause: () => void;
    isPlaying: boolean;
    trimRange?: TrimRange;
}

export default function EpisodeChart({
    actions,
    joints,
    fps,
    time,
    seek,
    play,
    pause,
    isPlaying,
    trimRange,
}: EpisodeChartProps) {
    const [hoverPosition, setHoverPosition] = useState<number | undefined>(undefined);
    const [mouseDown, setMouseDown] = useState<boolean>(false);
    const posJoints = useMemo(() => joints.filter(isPosJoint), [joints]);
    const chartData = useMemo(() => {
        return buildChartData(actions, posJoints, fps);
    }, [actions, posJoints, fps]);
    const ticks = useMemo(
        () => [...Array(Math.floor((actions.length / fps) * 2)).keys()].map((m) => m / 2),
        [actions.length, fps]
    );

    const continuePlayingOnRelease = useRef<boolean>(false);

    const handleMouseMove = useCallback(
        (nextState: MouseHandlerDataParam) => {
            if (nextState.activeLabel === undefined) {
                setHoverPosition(undefined);
            } else {
                const newTime = parseFloat(String(nextState.activeLabel ?? '0'));
                if (mouseDown) {
                    seek(newTime);
                }
                setHoverPosition(newTime);
            }
        },
        [mouseDown, seek]
    );

    const handleMouseUp = useCallback(
        (nextState: MouseHandlerDataParam) => {
            if (nextState.activeLabel !== undefined) {
                const newTime = parseFloat(String(nextState.activeLabel ?? '0'));
                seek(newTime);
            }
            setMouseDown(false);
            if (continuePlayingOnRelease.current) {
                play();
            }
        },
        [seek, play]
    );

    const handleMouseDown = useCallback(() => {
        setMouseDown(true);
        continuePlayingOnRelease.current = isPlaying;
        pause();
    }, [isPlaying, pause]);

    return (
        <ResponsiveContainer width='100%' height={CHART_HEIGHT} style={{ userSelect: 'none' }}>
            <LineChart
                data={chartData}
                margin={CHART_MARGIN}
                onMouseUp={handleMouseUp}
                onMouseDown={handleMouseDown}
                onMouseMove={handleMouseMove}
            >
                <CartesianGrid opacity={0.2} />
                <XAxis
                    dataKey='index'
                    label={{ value: 'Time (s)', position: 'insideBottomRight', offset: -10 }}
                    ticks={ticks}
                    domain={[0, actions.length / fps]}
                    type='number'
                />
                <YAxis width={Y_AXIS_WIDTH} label={{ value: 'Value (deg)', angle: -90, position: 'insideLeft' }} />

                <Legend position='top' height={36} offset={10} />
                {trimRange !== undefined && trimRange.start > 0 && (
                    <ReferenceArea x1={0} x2={trimRange.start / fps} ifOverflow='hidden' fill='#000' stroke='none' />
                )}
                {trimRange !== undefined && trimRange.end < actions.length && (
                    <ReferenceArea
                        x1={trimRange.end / fps}
                        x2={actions.length / fps}
                        ifOverflow='hidden'
                        fill='#000'
                        stroke='none'
                    />
                )}
                {hoverPosition !== undefined && (
                    <ReferenceLine x={hoverPosition} stroke='#5ac3f8' label='' strokeWidth={2} />
                )}
                <ReferenceLine x={time} stroke='#ffffff' label='' strokeWidth={2} />

                {posJoints.map((joint, i) => (
                    <Line
                        isAnimationActive={false}
                        key={joint}
                        type='monotone'
                        dataKey={joint}
                        stroke={lineColors.at(i % lineColors.length)}
                        name={toCapitalizedWords(stripPosSuffix(joint))}
                        dot={false}
                        activeDot={false}
                        strokeWidth={2}
                    />
                ))}
            </LineChart>
        </ResponsiveContainer>
    );
}
