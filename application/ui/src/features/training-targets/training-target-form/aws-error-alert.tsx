import { useEffect } from 'react';

import { toast } from '@geti-ui/ui';

import { getApiErrorMessage } from '../../../api/errors';
import { SchemaAwsAuthenticationIssue } from '../../../api/openapi-spec';

const authenticationToasts = new Map<string, () => void>();

export const notifyAwsAuthentication = (issue: SchemaAwsAuthenticationIssue) => {
    if (authenticationToasts.has(issue.profile_name)) return;
    authenticationToasts.set(issue.profile_name, showAwsError(issue));
};

export const clearAwsAuthentication = (profileName: string) => {
    authenticationToasts.get(profileName)?.();
    authenticationToasts.delete(profileName);
};

export const showAwsError = (error: unknown) => {
    const details = error && typeof error === 'object' ? error : {};
    const detail =
        'detail' in details && typeof details.detail === 'string'
            ? details.detail
            : (getApiErrorMessage(error) ?? 'Could not connect to AWS.');
    const command = 'command' in details && typeof details.command === 'string' ? details.command : undefined;
    const close = toast.negative(detail, {
        actionLabel: command ? 'Copy command' : 'Copy details',
        shouldCloseOnAction: false,
        onAction: async () => {
            try {
                await navigator.clipboard.writeText(command ?? detail);
                close();
            } catch {
                toast.negative('Could not copy to clipboard.');
            }
        },
    });
    return close;
};

export const AwsErrorAlert = ({ error }: { error: unknown }) => {
    useEffect(() => showAwsError(error), [error]);
    return null;
};
