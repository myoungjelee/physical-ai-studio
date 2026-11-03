import type { ReactNode } from 'react';

import { rs } from '@rstest/core';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { HttpResponse } from 'msw';

import { http } from '../../../../api/utils';
import { server } from '../../../../msw-node-setup';
import { render } from '../../../../test-utils/render';
import { RobotFormProvider } from '../../robot-form/provider';
import { BimanualSO101SetupFlow } from './bimanual-setup-flow';

rs.mock('./wizard-provider', () => ({
    SetupWizardProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

rs.mock('./setup-wizard', () => ({
    SetupWizardContent: ({ onBimanualComplete }: { onBimanualComplete: (calibration: object) => Promise<void> }) => (
        <button
            type='button'
            onClick={() =>
                void onBimanualComplete({
                    shoulder_pan: {
                        id: 1,
                        drive_mode: 0,
                        homing_offset: 12,
                        range_min: 0,
                        range_max: 4095,
                    },
                })
            }
        >
            Finish this arm
        </button>
    ),
}));

describe('Direct Bimanual SO101 setup', () => {
    it('saves exactly one bimanual robot after both arms finish calibration', async () => {
        const requests: Array<Record<string, unknown>> = [];
        server.use(
            http.post('/api/projects/{project_id}/robots', async ({ request }) => {
                requests.push((await request.json()) as Record<string, unknown>);
                return HttpResponse.json(
                    {
                        id: 'robot-1',
                        name: 'Direct Dual Arm',
                        type: 'BimanualSO101_Follower',
                        payload: {
                            left_serial_number: 'LEFT',
                            right_serial_number: 'RIGHT',
                            left_calibration: null,
                            right_calibration: null,
                            baudrate: 1000000,
                            role: 'follower',
                            disable_torque_on_disconnect: true,
                        },
                    },
                    { status: 201 }
                );
            })
        );

        const user = userEvent.setup();
        render(
            <RobotFormProvider
                robot={{
                    type: 'BimanualSO101_Follower',
                    name: 'Direct Dual Arm',
                    payload: {
                        left_serial_number: 'LEFT',
                        right_serial_number: 'RIGHT',
                        role: 'follower',
                    },
                }}
            >
                <BimanualSO101SetupFlow />
            </RobotFormProvider>,
            {
                route: '/projects/project-1/robots/new/so101-setup',
                path: '/projects/:project_id/robots/new/so101-setup',
            }
        );

        expect(screen.getByText(/1\/2 Left arm/)).toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: 'Finish this arm' }));
        expect(screen.getByText(/2\/2 Right arm/)).toBeInTheDocument();
        expect(requests).toHaveLength(0);

        await user.click(screen.getByRole('button', { name: 'Finish this arm' }));
        await waitFor(() => expect(requests).toHaveLength(1));
        expect(requests[0].type).toBe('BimanualSO101_Follower');
        expect(requests[0].payload).toMatchObject({
            left_serial_number: 'LEFT',
            right_serial_number: 'RIGHT',
            role: 'follower',
            left_calibration: { shoulder_pan: { id: 1 } },
            right_calibration: { shoulder_pan: { id: 1 } },
        });
    });
});
