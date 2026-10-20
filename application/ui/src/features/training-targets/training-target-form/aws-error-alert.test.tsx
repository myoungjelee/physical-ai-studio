import { toast } from '@geti-ui/ui';
import { rs } from '@rstest/core';
import userEvent from '@testing-library/user-event';

import {
    clearAwsAuthentication,
    notifyAwsAuthentication,
    observeAwsTrainerAuthentication,
    showAwsError,
} from './aws-error-alert';

describe('AWS error toast', () => {
    beforeEach(() => {
        rs.restoreAllMocks();
    });
    it('shows concrete instructions and copies only the command', async () => {
        userEvent.setup();
        const close = rs.fn();
        const negative = rs.spyOn(toast, 'negative').mockReturnValue(close);
        const positive = rs.spyOn(toast, 'positive').mockReturnValue(rs.fn());
        const write = rs.spyOn(navigator.clipboard, 'writeText').mockResolvedValue(undefined);
        const command = "aws sso login '--profile=team studio'";
        showAwsError({ detail: 'Renew the team studio profile on the backend host.', command });
        const [message, options] = negative.mock.calls[0];
        expect(message).toContain('team studio');
        expect(options?.actionLabel).toBe('Copy command');
        await options?.onAction?.();
        expect(write).toHaveBeenCalledWith(command);
        expect(close).toHaveBeenCalledOnce();
        expect(positive).not.toHaveBeenCalled();
    });

    it('copies details for errors without commands and handles clipboard failures', async () => {
        userEvent.setup();
        const negative = rs.spyOn(toast, 'negative').mockReturnValue(rs.fn());
        rs.spyOn(navigator.clipboard, 'writeText').mockRejectedValue(new Error('denied'));
        showAwsError({ detail: 'Check role trust.' });
        const options = negative.mock.calls[0][1];
        expect(options?.actionLabel).toBe('Copy details');
        await options?.onAction?.();
        expect(negative).toHaveBeenCalledWith('Could not copy to clipboard.');
    });

    it('deduplicates by profile until access recovers', () => {
        const close = rs.fn();
        const negative = rs.spyOn(toast, 'negative').mockReturnValue(close);
        const issue = {
            profile_name: 'dedup-studio',
            code: 'aws_credentials_expired',
            title: 'Session expired',
            detail: 'Renew dedup-studio on the backend host.',
            command: 'aws sso login --profile=dedup-studio',
        };
        notifyAwsAuthentication(issue);
        notifyAwsAuthentication({ ...issue });
        expect(negative).toHaveBeenCalledTimes(1);
        clearAwsAuthentication(issue.profile_name);
        expect(close).toHaveBeenCalledOnce();
        notifyAwsAuthentication(issue);
        expect(negative).toHaveBeenCalledTimes(2);
        clearAwsAuthentication(issue.profile_name);
    });

    it('keeps trainer and non-health warnings independent for the same profile', () => {
        const close = rs.fn();
        const negative = rs.spyOn(toast, 'negative').mockReturnValue(close);
        const issue = {
            profile_name: 'shared-studio',
            code: 'aws_credentials_expired',
            title: 'Session expired',
            detail: 'Renew shared-studio.',
            command: 'aws sso login --profile=shared-studio',
        };
        const observer = observeAwsTrainerAuthentication('shared-trainer');
        const health = {
            remote_trainer_id: 'shared-trainer',
            status: 'healthy' as const,
            checked_at: '2026-10-20T12:00:00Z',
            devices: [],
        };
        observer.update({ ...health, authentication_issue: issue });
        notifyAwsAuthentication(issue);
        clearAwsAuthentication(issue.profile_name);
        expect(close).not.toHaveBeenCalled();

        notifyAwsAuthentication(issue);
        observer.update(health);
        observer.unsubscribe();
        expect(close).not.toHaveBeenCalled();
        expect(negative).toHaveBeenCalledOnce();

        clearAwsAuthentication(issue.profile_name);
        expect(close).toHaveBeenCalledOnce();
    });
});
