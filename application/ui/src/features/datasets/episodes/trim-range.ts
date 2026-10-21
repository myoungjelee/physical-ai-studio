export interface TrimRange {
    start: number;
    end: number;
}

export const MIN_TRIM_FRAMES = 2;
export const MOTION_THRESHOLD = 0.5;
export const MOTION_PADDING_SECONDS = 0.25;

export const getFullTrimRange = (length: number): TrimRange => ({ start: 0, end: length });

export const isFullTrimRange = (range: TrimRange, length: number): boolean => range.start === 0 && range.end === length;

export const canSubmitTrim = (range: TrimRange, length: number): boolean =>
    range.start >= 0 &&
    range.end <= length &&
    range.end - range.start >= MIN_TRIM_FRAMES &&
    !isFullTrimRange(range, length);

const secondsFormatter = new Intl.NumberFormat('en-US', {
    style: 'unit',
    unit: 'second',
    unitDisplay: 'narrow',
    maximumFractionDigits: 2,
});

export const formatTrimRangeLabel = (range: TrimRange, fps: number): string =>
    `${secondsFormatter.format(range.start / fps)} – ${secondsFormatter.format(range.end / fps)}`;

export const suggestTrimRange = (actions: number[][], actionKeys: string[], fps: number): TrimRange | undefined => {
    const posColumns = actionKeys.flatMap((key, column) => (key.endsWith('.pos') ? [column] : []));
    if (posColumns.length === 0) return undefined;

    const isMoving = (frame: number) =>
        posColumns.some((column) => Math.abs(actions[frame][column] - actions[frame - 1][column]) > MOTION_THRESHOLD);

    let firstMoving = -1;
    let lastMoving = -1;
    for (let frame = 1; frame < actions.length; frame++) {
        if (isMoving(frame)) {
            if (firstMoving === -1) firstMoving = frame;
            lastMoving = frame;
        }
    }
    if (firstMoving === -1) return undefined;

    const pad = Math.round(MOTION_PADDING_SECONDS * fps);
    const start = Math.max(0, firstMoving - 1 - pad);
    const end = Math.min(actions.length, lastMoving + 1 + pad);

    return end - start >= MIN_TRIM_FRAMES ? { start, end } : undefined;
};
