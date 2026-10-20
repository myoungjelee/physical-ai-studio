import { toast } from '@geti-ui/ui';
import { rs } from '@rstest/core';
import { act, waitFor } from '@testing-library/react';
import { HttpResponse } from 'msw';

import { SchemaAwsAuthenticationIssue, SchemaRemoteTrainerHealth } from '../../api/openapi-spec';
import { http } from '../../api/utils';
import { server } from '../../msw-node-setup';
import { createQueryClient } from '../../query-client/query-client';
import { renderHook } from '../../test-utils/render';
import { useRemoteTrainersHealth } from './training-targets-table/use-remote-trainers-health';
import { useRemoteTrainerHealth } from './use-remote-trainer-health';

const issue: SchemaAwsAuthenticationIssue = {
    profile_name: 'health-studio',
    code: 'aws_credentials_expired',
    title: 'Session expired',
    detail: 'Renew health-studio on the backend host.',
    command: 'aws sso login --profile=health-studio',
};

const useSingleHealth = (id: string) => useRemoteTrainerHealth(id).health;
const useMultipleHealth = (id: string) => useRemoteTrainersHealth([id]).get(id)?.health;

describe.each([
    ['single trainer', useSingleHealth],
    ['trainer list', useMultipleHealth],
] as const)('%s authentication notifications', (_name, useHealth) => {
    let expired: Set<string>;
    let close: ReturnType<typeof rs.fn>;
    let negative: ReturnType<typeof rs.spyOn<typeof toast, 'negative'>>;

    beforeEach(() => {
        expired = new Set(['aws']);
        close = rs.fn();
        negative = rs.spyOn(toast, 'negative').mockReturnValue(close);
        server.use(
            http.get('/api/remote-trainers/{remote_trainer_id}/health', ({ params }) => {
                const id = String(params.remote_trainer_id);
                const health: SchemaRemoteTrainerHealth = {
                    remote_trainer_id: id,
                    status: expired.has(id) ? 'unreachable' : 'healthy',
                    authentication_issue: expired.has(id) ? issue : null,
                    checked_at: '2026-10-20T12:00:00Z',
                    devices: [],
                };
                return HttpResponse.json(health);
            })
        );
    });

    afterEach(() => {
        rs.restoreAllMocks();
    });

    it('recovers after unmount and query eviction, then notifies on a later expiration', async () => {
        const queryClient = createQueryClient();
        const first = renderHook(() => useHealth('aws'), { queryClient });
        await waitFor(() => expect(negative).toHaveBeenCalledOnce());
        first.unmount();
        queryClient.removeQueries();
        expect(close).not.toHaveBeenCalled();

        expired.clear();
        const second = renderHook(() => useHealth('aws'), { queryClient });
        await waitFor(() => expect(close).toHaveBeenCalledOnce());

        expired.add('aws');
        await act(() => queryClient.invalidateQueries());
        await waitFor(() => expect(negative).toHaveBeenCalledTimes(2));

        expired.clear();
        await act(() => queryClient.invalidateQueries());
        await waitFor(() => expect(close).toHaveBeenCalledTimes(2));
        second.unmount();
    });

    it('keeps the AWS warning when switching to a healthy unrelated trainer', async () => {
        const queryClient = createQueryClient();
        let trainerId = 'aws';
        const view = renderHook(() => useHealth(trainerId), { queryClient });
        await waitFor(() => expect(negative).toHaveBeenCalledOnce());

        trainerId = 'direct';
        view.rerender();
        await waitFor(() => expect(view.result.current?.remote_trainer_id).toBe('direct'));
        expect(close).not.toHaveBeenCalled();

        expired.clear();
        trainerId = 'aws';
        view.rerender();
        await act(() => queryClient.invalidateQueries());
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        view.unmount();
    });

    it('preserves another trainer warning for the same profile across observer cleanup and recovery', async () => {
        const queryClient = createQueryClient();
        expired.add('other-aws');
        const single = renderHook(() => useRemoteTrainerHealth('aws'), { queryClient });
        const list = renderHook(() => useRemoteTrainersHealth(['aws']), { queryClient });
        const other = renderHook(() => useHealth('other-aws'), { queryClient });
        await waitFor(() => {
            expect(single.result.current.health?.authentication_issue).toEqual(issue);
            expect(list.result.current.get('aws')?.health?.authentication_issue).toEqual(issue);
            expect(other.result.current?.authentication_issue).toEqual(issue);
        });
        single.unmount();
        expect(close).not.toHaveBeenCalled();

        expired.delete('aws');
        await act(() => queryClient.invalidateQueries());
        await waitFor(() => expect(list.result.current.get('aws')?.health?.status).toBe('healthy'));
        expect(close).not.toHaveBeenCalled();
        expect(negative).toHaveBeenCalledOnce();
        list.unmount();

        expired.clear();
        await act(() => queryClient.invalidateQueries());
        await waitFor(() => expect(close).toHaveBeenCalledOnce());
        other.unmount();
    });
});
