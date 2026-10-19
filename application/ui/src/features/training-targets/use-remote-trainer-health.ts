import { useEffect, useRef } from 'react';

import { $api } from '../../api/client';
import { clearAwsAuthentication, notifyAwsAuthentication } from './training-target-form/aws-error-alert';

const REMOTE_UNAVAILABLE_POLL_MS = 15000;
const REMOTE_STARTING_POLL_MS = 5000;

/**
 * Reads a remote trainer's health and retries unavailable trainers until they recover.
 */
export const useRemoteTrainerHealth = (remoteTrainerId: string | null) => {
    const affectedProfile = useRef<string | undefined>(undefined);
    const query = $api.useQuery(
        'get',
        '/api/remote-trainers/{remote_trainer_id}/health',
        { params: { path: { remote_trainer_id: remoteTrainerId ?? '' } } },
        {
            enabled: remoteTrainerId !== null,
            refetchOnMount: 'always',
            refetchInterval: (healthQuery) => {
                const status = healthQuery.state.data?.status;
                if (status === 'starting') return REMOTE_STARTING_POLL_MS;
                return status === 'unreachable' || healthQuery.state.data?.authentication_issue
                    ? REMOTE_UNAVAILABLE_POLL_MS
                    : false;
            },
        }
    );
    useEffect(() => {
        const issue = query.data?.authentication_issue;
        if (issue) {
            affectedProfile.current = issue.profile_name;
            notifyAwsAuthentication(issue);
        } else if (query.data?.status === 'healthy' && affectedProfile.current) {
            clearAwsAuthentication(affectedProfile.current);
            affectedProfile.current = undefined;
        }
    }, [query.data]);

    return {
        health: query.data,
        isChecking: query.isFetching,
        hasError: query.isError,
        checkHealth: async () => {
            const result = await query.refetch();
            return result.isError ? null : (result.data ?? null);
        },
    };
};
