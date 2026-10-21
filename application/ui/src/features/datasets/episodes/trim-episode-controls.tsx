import { Button, Flex, RangeSlider, toast, View } from '@geti-ui/ui';

import { getApiErrorMessage } from '../../../api/errors';
import { SchemaEpisode } from '../../../api/openapi-spec';
import { CHART_MARGIN, Y_AXIS_WIDTH } from '../../../components/episode-chart/episode-chart';
import { canSubmitTrim, formatTrimRangeLabel, suggestTrimRange, TrimRange } from './trim-range';
import { useTrimEpisodeQuery } from './use-episodes';
import { Player } from './use-player';

interface TrimEpisodeControlsProps {
    datasetId: string;
    episode: SchemaEpisode;
    player: Player;
    range: TrimRange;
    onRangeChange: (range: TrimRange) => void;
}

export const TrimEpisodeControls = ({ datasetId, episode, player, range, onRangeChange }: TrimEpisodeControlsProps) => {
    const { isPending, trimEpisode } = useTrimEpisodeQuery(datasetId, episode.episode_index);

    const handleRangeChange = (next: TrimRange) => {
        const previous = range;
        const startChanged = next.start !== previous.start;
        const endChanged = next.end !== previous.end;
        if (!startChanged && !endChanged) return;

        onRangeChange(next);
        player.pause();
        player.seek(startChanged ? next.start / episode.fps : (next.end - 1) / episode.fps);
    };

    const handleSuggest = () => {
        const suggestion = suggestTrimRange(episode.actions, episode.action_keys, episode.fps);
        if (suggestion === undefined) {
            toast.info('No idle frames detected.');
            return;
        }
        onRangeChange(suggestion);
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
        <>
            <View UNSAFE_style={{ paddingLeft: CHART_MARGIN.left + Y_AXIS_WIDTH, paddingRight: CHART_MARGIN.right }}>
                <RangeSlider
                    label='Keep'
                    minValue={0}
                    maxValue={episode.length}
                    step={1}
                    value={range}
                    onChange={handleRangeChange}
                    getValueLabel={(value) => formatTrimRangeLabel(value, episode.fps)}
                    width='100%'
                />
            </View>
            <Flex gap='size-100' justifyContent='end' margin='size-100'>
                <Button variant='secondary' onPress={handleSuggest}>
                    Suggest range
                </Button>
                <Button
                    variant='accent'
                    isPending={isPending}
                    isDisabled={!canSubmitTrim(range, episode.length) || isPending}
                    onPress={handleTrim}
                >
                    Trim
                </Button>
            </Flex>
        </>
    );
};
