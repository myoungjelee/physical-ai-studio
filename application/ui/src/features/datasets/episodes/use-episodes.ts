import { useQueryClient } from '@tanstack/react-query';

import { $api } from '../../../api/client';

export const useDeleteEpisodeQuery = (dataset_id: string) => {
    const queryClient = useQueryClient();

    const mutation = $api.useMutation('delete', '/api/dataset/{dataset_id}/episodes', {
        meta: {
            invalidates: [
                ['get', '/api/dataset/{dataset_id}/episodes', { params: { path: { dataset_id } } }],
                ['get', '/api/dataset/{dataset_id}', { params: { path: { dataset_id } } }],
            ],
        },
        onSuccess: (data) => {
            const query_key = [
                'get',
                '/api/dataset/{dataset_id}/episodes',
                {
                    params: {
                        path: {
                            dataset_id,
                        },
                    },
                },
            ];
            queryClient.setQueryData(query_key, data);
        },
    });

    const deleteEpisodes = (episodeIndices: number[]) => {
        return mutation.mutateAsync({
            params: {
                path: {
                    dataset_id,
                },
            },
            body: episodeIndices,
        });
    };

    return {
        ...mutation,
        deleteEpisodes,
    };
};

export const useOptimizeDatasetQuery = (dataset_id: string) => {
    const { data: jobs = [] } = $api.useQuery('get', '/api/jobs');
    const activeJob = jobs.find(
        (job) =>
            job.type === 'dataset_optimization' &&
            job.payload.dataset_id === dataset_id &&
            (job.status === 'pending' || job.status === 'running')
    );
    const mutation = $api.useMutation('post', '/api/dataset/{dataset_id}:optimize', {
        meta: {
            invalidates: [['get', '/api/jobs']],
        },
    });

    const optimizeDataset = () => mutation.mutateAsync({ params: { path: { dataset_id } } });

    return {
        ...mutation,
        activeJob,
        optimizeDataset,
    };
};

export const useTrimEpisodeQuery = (dataset_id: string, episode_index: number) => {
    const mutation = $api.useMutation('put', '/api/dataset/{dataset_id}/episodes/{episode_index}', {
        meta: {
            invalidates: [
                ['get', '/api/dataset/{dataset_id}/episodes', { params: { path: { dataset_id } } }],
                [
                    'get',
                    '/api/dataset/{dataset_id}/episodes/{episode_index}',
                    { params: { path: { dataset_id, episode_index } } },
                ],
            ],
        },
    });

    const trimEpisode = (start_frame: number, end_frame: number) =>
        mutation.mutateAsync({
            params: { path: { dataset_id, episode_index } },
            body: { start_frame, end_frame },
        });

    return { ...mutation, trimEpisode };
};
