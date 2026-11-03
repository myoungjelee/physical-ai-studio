import { useState } from 'react';

import { Button, Flex, Item, Picker, Text } from '@geti-ui/ui';

import { $api } from '../../../../api/client';
import type { SchemaSo101JointCalibration } from '../../../../api/openapi-spec';
import { useProjectId } from '../../../projects/use-project';
import { useDiscoverRobotsQuery } from '../../robot-catalog.hooks';
import type { SchemaRobot } from '../../robot-types';
import { useRobotForm } from '../provider';

type SourceRobot = Extract<SchemaRobot, { type: 'SO101_Follower' | 'SO101_Leader' }>;

type BimanualSO101Payload = {
    left_serial_number: string;
    right_serial_number: string;
    left_calibration: Record<string, SchemaSo101JointCalibration> | null;
    right_calibration: Record<string, SchemaSo101JointCalibration> | null;
    role: 'follower' | 'leader';
};

export const hasDirectBimanualPorts = (payload: Record<string, unknown>): boolean =>
    typeof payload.left_serial_number === 'string' &&
    payload.left_serial_number.trim() !== '' &&
    typeof payload.right_serial_number === 'string' &&
    payload.right_serial_number.trim() !== '' &&
    payload.left_serial_number !== payload.right_serial_number;

export const hasBimanualCalibrations = (payload: Record<string, unknown>): boolean =>
    ['left_calibration', 'right_calibration'].every((key) => {
        const value = payload[key];
        return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
    });

const isEligibleSource = (robot: SchemaRobot, type: SourceRobot['type']): robot is SourceRobot =>
    robot.type === type && robot.payload.serial_number !== '' && robot.payload.calibration != null;

interface SO101ArmPickerProps {
    arm: 'left' | 'right';
    robots: SourceRobot[];
    selectedKey: string | number | null;
    onSelect: (robotId: string | number | null) => void;
}

const SO101ArmPicker = ({ arm, robots, selectedKey, onSelect }: SO101ArmPickerProps) => (
    <Picker isRequired label={`Select ${arm} arm`} width='100%' selectedKey={selectedKey} onSelectionChange={onSelect}>
        {robots.map((robot) => (
            <Item key={robot.id} textValue={robot.name}>
                <Text>{robot.name}</Text>
                <Text slot='description'>{robot.payload.serial_number}</Text>
            </Item>
        ))}
    </Picker>
);

export const BimanualSO101FormFields = () => {
    const { project_id } = useProjectId();
    const { activeType, payload, setPayload, updatePayloadField } = useRobotForm();
    const formPayload = payload as BimanualSO101Payload;
    const [mode, setMode] = useState<'existing' | 'direct'>(
        hasDirectBimanualPorts(payload) && !hasBimanualCalibrations(payload) ? 'direct' : 'existing'
    );
    const robotsQuery = $api.useSuspenseQuery('get', '/api/projects/{project_id}/robots', {
        params: { path: { project_id } },
    });
    const sourceType = activeType === 'BimanualSO101_Leader' ? 'SO101_Leader' : 'SO101_Follower';
    const discovered = useDiscoverRobotsQuery(sourceType);
    const devices = (discovered.data ?? []).filter((device): device is typeof device & { serial_number: string } =>
        Boolean(device.serial_number && device.serial_number !== 'no_serial')
    );
    const eligibleRobots = robotsQuery.data.filter((robot) => isEligibleSource(robot, sourceType));
    const leftRobots = eligibleRobots.filter(
        (robot) => robot.payload.serial_number !== formPayload.right_serial_number
    );
    const rightRobots = eligibleRobots.filter(
        (robot) => robot.payload.serial_number !== formPayload.left_serial_number
    );

    const selectArm = (arm: 'left' | 'right', robotId: string | number | null) => {
        const robot = eligibleRobots.find(({ id }) => id === robotId);
        if (robot === undefined || robot.payload.calibration === null) {
            return;
        }
        updatePayloadField(`${arm}_serial_number`, robot.payload.serial_number);
        updatePayloadField(`${arm}_calibration`, robot.payload.calibration);
        updatePayloadField('role', activeType === 'BimanualSO101_Leader' ? 'leader' : 'follower');
    };

    const selectedRobotId = (arm: 'left' | 'right') =>
        eligibleRobots.find((robot) => robot.payload.serial_number === formPayload[`${arm}_serial_number`])?.id ?? null;

    const selectDirectArm = (arm: 'left' | 'right', serial: string | number | null) => {
        if (typeof serial !== 'string' || !devices.some((device) => device.serial_number === serial)) return;
        setPayload({
            ...payload,
            [`${arm}_serial_number`]: serial,
            [`${arm}_calibration`]: null,
            role: activeType === 'BimanualSO101_Leader' ? 'leader' : 'follower',
        });
    };

    const selectMode = (selected: string | number | null) => {
        if (selected !== 'direct' && selected !== 'existing') return;
        setMode(selected);
        // Never mix stale calibrations from an assembled robot with directly selected ports.
        setPayload({
            role: activeType === 'BimanualSO101_Leader' ? 'leader' : 'follower',
        });
    };

    return (
        <Flex direction='column' gap='size-100' width='100%'>
            <Picker label='Setup method' width='100%' selectedKey={mode} onSelectionChange={selectMode}>
                <Item key='existing'>Use two registered, calibrated arms</Item>
                <Item key='direct'>Set up both arms directly (no single-arm registration)</Item>
            </Picker>
            {mode === 'existing' ? (
                <>
                    <SO101ArmPicker
                        arm='left'
                        robots={leftRobots}
                        selectedKey={selectedRobotId('left')}
                        onSelect={(robotId) => selectArm('left', robotId)}
                    />
                    <SO101ArmPicker
                        arm='right'
                        robots={rightRobots}
                        selectedKey={selectedRobotId('right')}
                        onSelect={(robotId) => selectArm('right', robotId)}
                    />
                </>
            ) : (
                <>
                    <Text>Select two different USB controllers. Each arm is diagnosed and calibrated in turn.</Text>
                    <Button
                        variant='secondary'
                        onPress={() => void discovered.refetch()}
                        isDisabled={discovered.isFetching}
                    >
                        Refresh USB controllers
                    </Button>
                    {(['left', 'right'] as const).map((arm) => (
                        <Picker
                            key={arm}
                            isRequired
                            label={`${arm === 'left' ? 'Left' : 'Right'} arm USB controller`}
                            width='100%'
                            selectedKey={formPayload[`${arm}_serial_number`] ?? null}
                            onSelectionChange={(serial) => selectDirectArm(arm, serial)}
                        >
                            {devices
                                .filter(
                                    (device) =>
                                        device.serial_number !==
                                        formPayload[`${arm === 'left' ? 'right' : 'left'}_serial_number`]
                                )
                                .map((device) => (
                                    <Item key={device.serial_number} textValue={device.serial_number}>
                                        <Text>{device.serial_number}</Text>
                                        <Text slot='description'>{device.connection_string}</Text>
                                    </Item>
                                ))}
                        </Picker>
                    ))}
                    <Text>
                        {devices.length < 2
                            ? 'Two USB controllers with unique serial numbers must be connected.'
                            : 'Both arms will be saved as one bimanual robot after calibration.'}
                    </Text>
                </>
            )}
        </Flex>
    );
};
