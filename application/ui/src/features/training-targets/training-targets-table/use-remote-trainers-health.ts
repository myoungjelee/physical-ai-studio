import { useEffect, useRef } from 'react';

import { useQueries } from '@tanstack/react-query';

import { $api } from '../../../api/client';
import { SchemaRemoteTrainerHealth } from '../../../api/openapi-spec';
import { clearAwsAuthentication, notifyAwsAuthentication } from '../training-target-form/aws-error-alert';

const REMOTE_UNAVAILABLE_POLL_MS = 15000;
const REMOTE_STARTING_POLL_MS = 5000;

type RemoteTrainerHealthEntry = {
    health?: SchemaRemoteTrainerHealth;
    isChecking: boolean;
    hasError: boolean;
    checkHealth: () => Promise<SchemaRemoteTrainerHealth | null>;
};

/**
 * Batch-fetches health for a set of remote trainers, sharing the query cache with
 * `useRemoteTrainerHealth` (identical query key), and retries unreachable trainers until they recover.
 */
export const useRemoteTrainersHealth = (remoteTrainerIds: string[]): Map<string, RemoteTrainerHealthEntry> => {
    const affected = useRef(new Map<string, string>());
    const queries = useQueries({
        queries: remoteTrainerIds.map((remoteTrainerId) =>
            $api.queryOptions(
                'get',
                '/api/remote-trainers/{remote_trainer_id}/health',
                { params: { path: { remote_trainer_id: remoteTrainerId } } },
                {
                    refetchOnMount: 'always',
                    refetchInterval: (healthQuery) => {
                        const status = healthQuery.state.data?.status;
                        if (status === 'starting') return REMOTE_STARTING_POLL_MS;
                        return status === 'unreachable' || healthQuery.state.data?.authentication_issue
                            ? REMOTE_UNAVAILABLE_POLL_MS
                            : false;
                    },
                }
            )
        ),
    });
    useEffect(() => {
        queries.forEach((query, index) => {
            const id = remoteTrainerIds[index];
            const issue = query.data?.authentication_issue;
            if (issue) {
                affected.current.set(id, issue.profile_name);
                notifyAwsAuthentication(issue);
            } else if (query.data?.status === 'healthy' && affected.current.has(id)) {
                clearAwsAuthentication(affected.current.get(id)!);
                affected.current.delete(id);
            }
        });
    }, [queries, remoteTrainerIds]);

    return new Map(
        remoteTrainerIds.map((remoteTrainerId, index) => {
            const query = queries[index];
            return [
                remoteTrainerId,
                {
                    health: query.data,
                    isChecking: query.isPending,
                    hasError: query.isError,
                    checkHealth: async () => {
                        const result = await query.refetch();
                        return result.isError ? null : (result.data ?? null);
                    },
                },
            ];
        })
    );
};
