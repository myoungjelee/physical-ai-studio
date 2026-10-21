import { useEffect, useState } from 'react';

import { Disclosure, DisclosurePanel, DisclosureTitle, Divider, Flex, Text } from '@geti-ui/ui';

import { SchemaDatasetOutput, SchemaEnvironmentWithRelations, SchemaEpisode } from '../../../api/openapi-spec';
import EpisodeChart from '../../../components/episode-chart/episode-chart';
import { RobotModelsProvider } from '../../robots/robot-models-context';
import { EpisodeDockView } from './episode-dock-view';
import { EpisodeTag } from './episode-tag';
import { EpisodeViewerProvider, useEpisodeViewer } from './episode-viewer-provider.component';
import { TimelineControls } from './timeline-controls';
import { TrimEpisodeControls } from './trim-episode-controls';
import { getFullTrimRange, TrimRange } from './trim-range';
import { Player } from './use-player';

import classes from './episode-viewer.module.css';

interface EpisodeViewerProps {
    episode: SchemaEpisode;
    dataset: SchemaDatasetOutput;
    environment: SchemaEnvironmentWithRelations;
}

interface LiveEpisodeChartProps {
    episode: SchemaEpisode;
    player: Player;
    trimRange?: TrimRange;
}

const LiveEpisodeChart = ({ episode, player, trimRange }: LiveEpisodeChartProps) => {
    const highlightedRange = trimRange && {
        start: trimRange.start / episode.fps,
        end: trimRange.end / episode.fps,
    };

    const [time, setTime] = useState<number>(player.timeRef.current);

    useEffect(() => {
        setTime(player.timeRef.current);
        if (player.isPlaying) {
            const interval = setInterval(() => {
                setTime(player.timeRef.current);
            }, 1000 / 60);
            return () => clearInterval(interval);
        }
    }, [player.timeRef, player.state, player.isPlaying]);

    const onSeek = (newTime: number) => {
        player.seek(newTime);
        setTime(newTime);
    };

    return (
        <EpisodeChart
            actions={episode.actions}
            joints={episode.action_keys}
            fps={episode.fps}
            time={time}
            seek={onSeek}
            isPlaying={player.isPlaying}
            play={player.play}
            pause={player.pause}
            highlightedRange={highlightedRange}
        />
    );
};

interface EpisodeTrimTimelineProps {
    datasetId: string;
    episode: SchemaEpisode;
    player: Player;
}

const EpisodeTrimTimeline = ({ datasetId, episode, player }: EpisodeTrimTimelineProps) => {
    const [range, setRange] = useState<TrimRange>(() => getFullTrimRange(episode.length));

    return (
        <>
            <LiveEpisodeChart episode={episode} player={player} trimRange={range} />
            <TrimEpisodeControls
                datasetId={datasetId}
                episode={episode}
                player={player}
                range={range}
                onRangeChange={setRange}
            />
        </>
    );
};

const EpisodeTimelineComponent = ({ datasetId }: { datasetId: string }) => {
    const { player, episode } = useEpisodeViewer();

    return (
        <div className={classes.timeline}>
            <Disclosure isQuiet>
                <DisclosureTitle>Timeline</DisclosureTitle>
                <DisclosurePanel>
                    <EpisodeTrimTimeline
                        key={`${episode.episode_index}-${episode.length}`}
                        datasetId={datasetId}
                        episode={episode}
                        player={player}
                    />
                </DisclosurePanel>
            </Disclosure>
            {/* We reset the time controls state for the new episode */}
            <TimelineControls key={episode.episode_index} player={player} />
        </div>
    );
};

export const EpisodeViewer = ({ episode, dataset, environment }: EpisodeViewerProps) => {
    return (
        <EpisodeViewerProvider episode={episode} environment={environment}>
            <RobotModelsProvider>
                <Flex direction={'column'} height={'100%'} position={'relative'}>
                    <Flex gap='size-100' marginBottom='size-100'>
                        <EpisodeTag episode={episode} variant='medium' />
                        <Divider orientation='vertical' size='S' />
                        <Text>{episode.tasks.join(', ')}</Text>
                    </Flex>
                    <Flex direction={'row'} flex gap={'size-100'}>
                        <EpisodeDockView
                            key={dataset.id}
                            episode={episode}
                            dataset={dataset}
                            environment={environment}
                        />
                    </Flex>
                    <EpisodeTimelineComponent datasetId={String(dataset.id)} />
                </Flex>
            </RobotModelsProvider>
        </EpisodeViewerProvider>
    );
};
