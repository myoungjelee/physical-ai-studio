import { useState } from 'react';

import { Button, Flex, NumberField, Text } from '@geti-ui/ui';

import { SchemaEpisode } from '../../../api/openapi-spec';
import { useTrimEpisodeQuery } from './use-episodes';
import { Player } from './use-player';

interface TrimEpisodeControlsProps {
    datasetId: string;
    episode: SchemaEpisode;
    player: Player;
}

export const TrimEpisodeControls = ({ datasetId, episode, player }: TrimEpisodeControlsProps) => {
    const [startFrame, setStartFrame] = useState(0);
    const [endFrame, setEndFrame] = useState(episode.length);
    const { isPending, trimEpisode } = useTrimEpisodeQuery(datasetId, episode.episode_index);
    const playheadFrame = Math.min(episode.length, Math.round(player.timeRef.current * episode.fps));
    const isValid = startFrame >= 0 && startFrame < endFrame && endFrame <= episode.length;

    return (
        <Flex direction='column' gap='size-100'>
            <Text>Trim episode frames</Text>
            <Flex gap='size-100' alignItems='end' wrap>
                <NumberField
                    label='Start frame'
                    value={startFrame}
                    minValue={0}
                    maxValue={episode.length - 1}
                    onChange={setStartFrame}
                />
                <Button variant='secondary' onPress={() => setStartFrame(playheadFrame)}>
                    Set from playhead
                </Button>
                <NumberField
                    label='End frame'
                    value={endFrame}
                    minValue={1}
                    maxValue={episode.length}
                    onChange={setEndFrame}
                />
                <Button variant='secondary' onPress={() => setEndFrame(playheadFrame)}>
                    Set from playhead
                </Button>
                <Button
                    variant='accent'
                    isPending={isPending}
                    isDisabled={!isValid || isPending}
                    onPress={() => trimEpisode(startFrame, endFrame)}
                >
                    Trim
                </Button>
            </Flex>
        </Flex>
    );
};
