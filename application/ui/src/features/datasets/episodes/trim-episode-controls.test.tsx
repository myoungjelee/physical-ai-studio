import { useState } from 'react';

import { toast } from '@geti-ui/ui';
import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { SchemaEpisode } from '../../../api/openapi-spec';
import { http } from '../../../api/utils';
import { server } from '../../../msw-node-setup';
import { getMockedEpisodeDetail } from '../../../test-utils/mocks/mock-episode';
import { render } from '../../../test-utils/render';
import { TrimEpisodeControls } from './trim-episode-controls';
import { getFullTrimRange, TrimRange } from './trim-range';
import { Player, PlayState } from './use-player';

const DATASET_ID = 'dataset-1';
const EPISODE_PATH = '/api/dataset/{dataset_id}/episodes/{episode_index}';
const FPS = 1;
const LENGTH = 10;

// Joint value per frame. The value changes at frames 2 and 5 only (first and last moving frame).
const MOVING_ACTIONS = [[0], [0], [10], [10], [10], [20], [20], [20], [20], [20]];
const IDLE_ACTIONS = Array.from({ length: LENGTH }, () => [0]);

// Suggested range for MOVING_ACTIONS: start = 2 - 1 = 1, end = 5 + 1 = 6.
const SUGGESTED_RANGE = { start: 1, end: 6 };
const SUGGESTED_LABEL = '1s – 6s';

const TOOLTIP_DELAY_MS = 1500;

const TRIM_RANGE = { start: 2, end: 8 };
const TRIM_LABEL = '2s – 8s';

const getMockedPlayer = (): Player => ({
    timeRef: { current: 0 },
    duration: LENGTH / FPS,
    state: PlayState.Paused,
    isPlaying: false,
    isPaused: true,
    isSeeking: false,
    play: rs.fn(),
    pause: rs.fn(),
    rewind: rs.fn(),
    seek: rs.fn(),
});

interface HarnessProps {
    episode: SchemaEpisode;
    player: Player;
    initialRange?: TrimRange;
}

const Harness = ({ episode, player, initialRange }: HarnessProps) => {
    const [range, setRange] = useState<TrimRange>(initialRange ?? getFullTrimRange(episode.length));

    return (
        <TrimEpisodeControls
            datasetId={DATASET_ID}
            episode={episode}
            player={player}
            range={range}
            onRangeChange={setRange}
        />
    );
};

const renderControls = (episodeOverrides: Partial<SchemaEpisode> = {}, initialRange?: TrimRange) => {
    const episode = getMockedEpisodeDetail({
        length: LENGTH,
        fps: FPS,
        actions: MOVING_ACTIONS,
        ...episodeOverrides,
    });
    const player = getMockedPlayer();
    const user = userEvent.setup();

    render(<Harness episode={episode} player={player} initialRange={initialRange} />);

    return { episode, player, user };
};

describe('TrimEpisodeControls', () => {
    let toastInfo: ReturnType<typeof rs.spyOn>;
    let toastPositive: ReturnType<typeof rs.spyOn>;
    let toastNegative: ReturnType<typeof rs.spyOn>;

    beforeEach(() => {
        toastInfo = rs.spyOn(toast, 'info').mockImplementation(() => () => {});
        toastPositive = rs.spyOn(toast, 'positive').mockImplementation(() => () => {});
        toastNegative = rs.spyOn(toast, 'negative').mockImplementation(() => () => {});
    });

    afterEach(() => {
        toastInfo.mockRestore();
        toastPositive.mockRestore();
        toastNegative.mockRestore();
    });

    it('disables Trim for the full range', async () => {
        renderControls();

        expect(await screen.findByRole('button', { name: 'Trim' })).toBeDisabled();
    });

    it('applies the suggested range to the slider and enables Trim', async () => {
        const { user } = renderControls();
        const [startThumb, endThumb] = await screen.findAllByRole('slider');
        expect(startThumb).toHaveValue('0');
        expect(endThumb).toHaveValue(String(LENGTH));

        await user.click(screen.getByRole('button', { name: 'Suggest range' }));

        expect(startThumb).toHaveValue(String(SUGGESTED_RANGE.start));
        expect(endThumb).toHaveValue(String(SUGGESTED_RANGE.end));
        expect(screen.getByText(SUGGESTED_LABEL)).toBeInTheDocument();
        expect(screen.getByRole('button', { name: 'Trim' })).toBeEnabled();
    });

    describe('tooltip', () => {
        beforeEach(() => {
            rs.useFakeTimers({ shouldAdvanceTime: true });
        });

        afterEach(() => {
            rs.useRealTimers();
        });

        it('explains how the range is suggested', async () => {
            renderControls();
            const user = userEvent.setup({ advanceTimers: (ms) => rs.advanceTimersByTime(ms) });
            const button = screen.getByRole('button', { name: 'Suggest range' });

            await user.pointer({ target: document.body });
            await user.hover(button);
            expect(screen.queryByRole('tooltip')).not.toBeInTheDocument();

            await act(() => rs.advanceTimersByTime(TOOLTIP_DELAY_MS));

            expect(screen.getByRole('tooltip')).toHaveTextContent(
                'Select frames where the robot is moving, skipping idle frames at the start and end.'
            );
        });
    });

    it('shows an info toast when no idle frames are detected', async () => {
        const { user } = renderControls({ actions: IDLE_ACTIONS });

        await user.click(await screen.findByRole('button', { name: 'Suggest range' }));

        expect(toastInfo).toHaveBeenCalledWith('No idle frames detected.');
        expect(screen.getByRole('button', { name: 'Trim' })).toBeDisabled();
    });

    it('pauses and seeks to the start frame when the start thumb is moved with the keyboard', async () => {
        const { player, user } = renderControls();

        const [startThumb] = await screen.findAllByRole('slider');
        startThumb.focus();
        await user.keyboard('{ArrowRight}');

        expect(player.pause).toHaveBeenCalled();
        expect(player.seek).toHaveBeenCalledWith(1);
    });

    it('seeks to the end frame only when the end thumb is moved', async () => {
        const { player, user } = renderControls();

        const [startThumb, endThumb] = await screen.findAllByRole('slider');
        startThumb.focus();
        await user.keyboard('{ArrowRight}{ArrowLeft}');
        expect(player.seek).not.toHaveBeenCalledWith(LENGTH - 1);

        // End is exclusive: moving it from 10 to 9 makes frame 8 the last kept frame.
        endThumb.focus();
        await user.keyboard('{ArrowLeft}');
        expect(player.seek).toHaveBeenLastCalledWith(8);
    });

    it('asks for confirmation with the range in seconds and does not trim when cancelled', async () => {
        let requested = false;
        server.use(
            http.put(EPISODE_PATH, () => {
                requested = true;
                return HttpResponse.json(getMockedEpisodeDetail());
            })
        );
        const { user } = renderControls({}, TRIM_RANGE);

        await user.click(await screen.findByRole('button', { name: 'Trim' }));

        const dialog = await screen.findByRole('alertdialog');
        expect(within(dialog).getByText(new RegExp(`trim this episode to ${TRIM_LABEL}`))).toBeInTheDocument();

        await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));

        await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
        expect(requested).toBe(false);
        expect(toastPositive).not.toHaveBeenCalled();
    });

    it('sends the current range to the backend and shows a success toast', async () => {
        let body: unknown;
        let pathParams: unknown;
        server.use(
            http.put(EPISODE_PATH, async ({ request, params }) => {
                body = await request.json();
                pathParams = params;
                return HttpResponse.json(getMockedEpisodeDetail({ length: 6 }));
            })
        );
        const { user } = renderControls({}, TRIM_RANGE);

        await user.click(await screen.findByRole('button', { name: 'Trim' }));
        const dialog = await screen.findByRole('alertdialog');
        await user.click(within(dialog).getByRole('button', { name: 'Trim' }));

        await waitFor(() => expect(toastPositive).toHaveBeenCalledWith('Episode trimmed.'));
        expect(body).toEqual({ start_frame: 2, end_frame: 8 });
        expect(pathParams).toEqual({ dataset_id: DATASET_ID, episode_index: '0' });
        expect(toastNegative).not.toHaveBeenCalled();
    });

    it('shows an error toast when the backend rejects the trim', async () => {
        server.use(
            http.put(EPISODE_PATH, () =>
                HttpResponse.json(
                    { detail: [{ loc: ['body', 'end_frame'], msg: 'end_frame exceeds length', type: 'value_error' }] },
                    { status: 422 }
                )
            )
        );
        const { user } = renderControls({}, TRIM_RANGE);

        await user.click(await screen.findByRole('button', { name: 'Trim' }));
        await user.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Trim' }));

        await waitFor(() => expect(toastNegative).toHaveBeenCalledWith('end_frame: end_frame exceeds length'));
        expect(toastPositive).not.toHaveBeenCalled();
    });
});
