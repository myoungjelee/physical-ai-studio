import { useState } from 'react';

import { Button, Flex, Heading, Text, View } from '@geti-ui/ui';
import { useNavigate } from 'react-router';
import { v4 as uuidv4 } from 'uuid';

import { $api } from '../../../../api/client';
import { paths } from '../../../../paths';
import { useProjectId } from '../../../projects/use-project';
import { hasDirectBimanualPorts } from '../../robot-form/catalog/bimanual-so101';
import { buildRobotBody } from '../../robot-form/form-data';
import { useRobotForm } from '../../robot-form/provider';
import { SetupWizardContent } from './setup-wizard';
import type { CalibrationResult } from './use-setup-websocket';
import { SetupWizardProvider } from './wizard-provider';

type Calibration = CalibrationResult['calibration'];

/**
 * Direct bimanual registration reuses the known-good SO101 setup protocol,
 * sequentially. Neither arm is ever persisted as a standalone robot.
 */
export const BimanualSO101SetupFlow = () => {
    const { project_id } = useProjectId();
    const navigate = useNavigate();
    const { activeType, robotForm } = useRobotForm();
    const [arm, setArm] = useState<'left' | 'right'>('left');
    const [leftCalibration, setLeftCalibration] = useState<Calibration | null>(null);
    const [robotId] = useState(() => uuidv4());

    const addRobotMutation = $api.useMutation('post', '/api/projects/{project_id}/robots', {
        meta: {
            invalidates: [
                ['get', '/api/projects/{project_id}/robots', { params: { path: { project_id } } }],
                ['get', '/api/projects/{project_id}/robots/online', { params: { path: { project_id } } }],
            ],
        },
    });

    const completeArm = async (calibration: Calibration) => {
        if (!hasDirectBimanualPorts(robotForm.payload)) {
            throw new Error('Both arms must have distinct USB serial numbers. Return to robot configuration.');
        }

        if (arm === 'left') {
            setLeftCalibration({ ...calibration });
            setArm('right');
            return;
        }

        if (!leftCalibration) {
            throw new Error('Calibrate and verify the left arm before the right arm.');
        }
        if (!activeType || !activeType.startsWith('BimanualSO101_')) {
            throw new Error('Invalid bimanual robot type.');
        }

        // Save once, only after both real controllers were verified. Keep the
        // side-specific calibration maps isolated; never create single robots.
        const body = buildRobotBody(
            {
                ...robotForm,
                payload: {
                    ...robotForm.payload,
                    left_calibration: leftCalibration,
                    right_calibration: calibration,
                    role: activeType === 'BimanualSO101_Leader' ? 'leader' : 'follower',
                },
            },
            activeType,
            robotId
        );
        if (!body) throw new Error('Robot name is required.');

        const robot = await addRobotMutation.mutateAsync({
            params: { path: { project_id } },
            body,
        });
        navigate(paths.project.robots.show({ project_id, robot_id: robot.id }));
    };

    if (!hasDirectBimanualPorts(robotForm.payload)) {
        return (
            <Flex direction='column' gap='size-200' margin='size-400'>
                <Heading level={3}>Connect both arms first</Heading>
                <Text>Two different USB controllers must be selected in robot configuration.</Text>
                <Button variant='secondary' onPress={() => navigate(-1)}>
                    Back to configuration
                </Button>
            </Flex>
        );
    }

    return (
        <Flex direction='column' gap='size-100' height='100%' minHeight={0}>
            <Flex alignItems='center' justifyContent='space-between' marginX='size-400' marginTop='size-200'>
                <Heading level={4} margin={0}>
                    Direct bimanual setup — {arm === 'left' ? '1/2 Left arm' : '2/2 Right arm'}
                </Heading>
                {arm === 'right' && (
                    <Button
                        variant='secondary'
                        onPress={() => {
                            setLeftCalibration(null);
                            setArm('left');
                        }}
                    >
                        Redo left arm
                    </Button>
                )}
            </Flex>
            <Text marginX='size-400'>
                Configure and verify the {arm} arm. The bimanual robot will be saved only after both arms are complete.
            </Text>
            <View
                flex={1}
                minHeight={0}
                backgroundColor='gray-100'
                padding='size-400'
                UNSAFE_style={{ overflow: 'hidden' }}
            >
                <SetupWizardProvider key={arm} setupArm={arm}>
                    <SetupWizardContent onBimanualComplete={completeArm} />
                </SetupWizardProvider>
            </View>
        </Flex>
    );
};
