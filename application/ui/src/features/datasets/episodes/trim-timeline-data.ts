import { SchemaEpisode } from '../../../api/openapi-spec';

export const JOINT_COLORS = ['#4e9cf5', '#e8684a', '#3fb27f', '#e0a33a', '#d85c8a', '#8e7cf0', '#5ac3f8'];
export const GRIPPER_COLOR = '#a78bfa';

export interface JointSeries {
    key: string;
    label: string;
    color: string;
    isGripper: boolean;
    values: number[];
}

export type Extent = [min: number, max: number];

const isGripper = (key: string) => key.startsWith('gripper');

/** One series per `.pos` action column, in column order. */
export const getJointSeries = ({ action_keys, actions }: SchemaEpisode): JointSeries[] => {
    const series = action_keys.flatMap((key, column) =>
        key.endsWith('.pos')
            ? [
                  {
                      key,
                      label: key.replace(/\.pos$/, '').replace(/_/g, ' '),
                      isGripper: isGripper(key),
                      values: actions.map((row) => row[column]),
                  },
              ]
            : []
    );

    let armIndex = 0;
    return series.map((item) => ({
        ...item,
        color: item.isGripper ? GRIPPER_COLOR : JOINT_COLORS[armIndex++ % JOINT_COLORS.length],
    }));
};

/** Σ|Δjoint| per frame; frame 0 is 0. Near zero means the arm is idle. */
export const getMotion = (series: JointSeries[], length: number): number[] =>
    Array.from({ length }, (_, frame) =>
        frame === 0 ? 0 : series.reduce((sum, { values }) => sum + Math.abs(values[frame] - values[frame - 1]), 0)
    );

export const getExtent = (values: number[]): Extent => {
    const min = Math.min(...values);
    const max = Math.max(...values);

    return min === max ? [min - 1, max + 1] : [min, max];
};

export const TRACK_WIDTH = 1000;
export const TRACK_HEIGHT = 100;

/**
 * SVG polyline `points` (`"x,y x,y ..."`) inside a `TRACK_WIDTH` × `TRACK_HEIGHT` viewBox.
 *
 * - x: frames are spread evenly, first frame at 0 and last frame at `TRACK_WIDTH`.
 * - y: `(value - min) / (max - min)` normalizes a value to 0..1 (0 = min, 1 = max), which is
 *   then scaled to the track height and flipped because SVG's y-axis points down.
 *
 * `extent` is passed in so the caller picks the scale (per joint or shared).
 */
export const toPolylinePoints = (values: number[], [min, max]: Extent): string => {
    const lastIndex = Math.max(1, values.length - 1);
    return values
        .map(
            (value, i) =>
                `${(i / lastIndex) * TRACK_WIDTH},${TRACK_HEIGHT - ((value - min) / (max - min)) * TRACK_HEIGHT}`
        )
        .join(' ');
};
