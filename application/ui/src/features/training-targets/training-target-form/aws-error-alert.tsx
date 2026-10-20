import { useEffect } from 'react';

import { toast } from '@geti-ui/ui';

import { getApiErrorMessage } from '../../../api/errors';
import { SchemaAwsAuthenticationIssue, SchemaRemoteTrainerHealth } from '../../../api/openapi-spec';

const authenticationToasts = new Map<string, { close: () => void; sources: Set<string> }>();
const trainerAuthentication = new Map<string, { observers: number; profileName?: string }>();

export const notifyAwsAuthentication = (issue: SchemaAwsAuthenticationIssue, source = 'profile') => {
    let notification = authenticationToasts.get(issue.profile_name);
    if (!notification) {
        notification = { close: showAwsError(issue), sources: new Set() };
        authenticationToasts.set(issue.profile_name, notification);
    }
    notification.sources.add(source);
};

export const clearAwsAuthentication = (profileName: string, source = 'profile') => {
    const notification = authenticationToasts.get(profileName);
    if (!notification) return;
    notification.sources.delete(source);
    if (notification.sources.size === 0) {
        notification.close();
        authenticationToasts.delete(profileName);
    }
};

export const clearAwsTrainerAuthentication = (trainerId: string) => {
    const state = trainerAuthentication.get(trainerId);
    if (state?.profileName) clearAwsAuthentication(state.profileName, `trainer:${trainerId}`);
    trainerAuthentication.delete(trainerId);
};

export const observeAwsTrainerAuthentication = (trainerId: string) => {
    const state = trainerAuthentication.get(trainerId) ?? { observers: 0 };
    trainerAuthentication.set(trainerId, state);
    state.observers++;
    const source = `trainer:${trainerId}`;
    const prune = () => {
        if (trainerAuthentication.get(trainerId) === state && state.observers === 0 && !state.profileName) {
            trainerAuthentication.delete(trainerId);
        }
    };
    return {
        update: (health: SchemaRemoteTrainerHealth | undefined) => {
            if (trainerAuthentication.get(trainerId) !== state || health?.remote_trainer_id !== trainerId) return;
            const issue = health.authentication_issue;
            if (issue) {
                if (state.profileName && state.profileName !== issue.profile_name) {
                    clearAwsAuthentication(state.profileName, source);
                }
                state.profileName = issue.profile_name;
                notifyAwsAuthentication(issue, source);
            } else if (health.status === 'healthy' && state.profileName) {
                clearAwsAuthentication(state.profileName, source);
                state.profileName = undefined;
                prune();
            }
        },
        unsubscribe: () => {
            state.observers--;
            // Keep unresolved trainer/profile associations across unmounts and query eviction.
            prune();
        },
    };
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
