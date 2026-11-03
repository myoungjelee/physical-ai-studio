import { useState } from 'react';

import {
    AlertDialog,
    Button,
    ComboBox,
    DialogContainer,
    Flex,
    Heading,
    Item,
    Link,
    NumberField,
    ProgressCircle,
    StatusLight,
    Switch,
    Text,
} from '@geti-ui/ui';
import { Back, DownloadIcon, Pause, Play } from '@geti-ui/ui/icons';

import { paths } from '../../../paths';
import { useProjectId } from '../../projects/use-project';
import { RobotControlView } from '../../robots/robot-control/robot-control-view';
import { RobotModelsProvider } from '../../robots/robot-models-context';
import { useRuntimeSession } from '../../robots/runtime-session-provider';
import { runtimeExportUrl } from '../runtime-export';

interface InferenceViewerProps {
    tasks: string[];
}

export const InferenceViewer = ({ tasks }: InferenceViewerProps) => {
    const { project_id } = useProjectId();

    // The prompt is free text; the dataset's tasks are offered as suggestions. Custom values must
    // stay allowed: otherwise the combo box discards typed text when it loses focus.
    const [task, setTask] = useState<string>(tasks[0] ?? '');
    const [replanInterval, setReplanIntervalInput] = useState<number>(100);
    const [isEmptyPromptDialogOpen, setIsEmptyPromptDialogOpen] = useState(false);

    const {
        model,
        readyForInference,
        state,
        startTask,
        stopTask,
        setReplanInterval,
        startDiagnostics,
        stopDiagnostics,
        setFollowerSource,
        environment,
        observation,
        inferenceDevice,
    } = useRuntimeSession();

    const canTeleoperate = state.has_leader;
    const isTeleoperating = state.follower_source === 'teleop';

    const exportUrl =
        model?.id !== undefined && inferenceDevice !== undefined
            ? runtimeExportUrl({
                  modelId: model.id,
                  environmentId: environment.id,
                  backend: inferenceDevice.backend,
                  device: inferenceDevice.device,
                  task,
              })
            : undefined;

    if (!readyForInference) {
        return (
            <Flex width='100%' height={'100%'} alignItems={'center'} justifyContent={'center'} direction={'column'}>
                <Heading level={2}>
                    <Text>Initializing</Text>
                    <ProgressCircle marginStart='size-200' size='S' isIndeterminate alignSelf={'center'} />
                </Heading>
                <Flex direction='column' margin='size-200'>
                    <StatusLight variant={state.model_loaded ? 'positive' : 'yellow'}>Model</StatusLight>
                    <StatusLight variant={state.connected ? 'positive' : 'yellow'}>Environment</StatusLight>
                </Flex>
                <Button variant={'secondary'} href={paths.project.models.index({ project_id })}>
                    Cancel
                </Button>
            </Flex>
        );
    }

    return (
        <RobotModelsProvider>
            <Flex flex direction={'column'} height={'100%'} position={'relative'}>
                <Flex direction='column' gap='size-150' margin='size-200'>
                    <Flex alignItems='center' gap='size-200' wrap>
                        <Link aria-label='Back to models' href={paths.project.models.index({ project_id })}>
                            <Back fill='white' />
                        </Link>
                        <Heading>Model Run {model?.name}</Heading>
                        <Flex flex minWidth='size-3000'>
                            <ComboBox
                                flex
                                aria-label='Task prompt'
                                allowsCustomValue
                                inputValue={task}
                                onInputChange={setTask}
                            >
                                {tasks.map((taskText) => (
                                    <Item key={taskText}>{taskText}</Item>
                                ))}
                            </ComboBox>
                        </Flex>
                        <Switch
                            isEmphasized
                            isSelected={isTeleoperating}
                            isDisabled={
                                !canTeleoperate || setFollowerSource.isPending || startTask.isPending || stopTask.isPending
                            }
                            onChange={(enabled) => setFollowerSource.mutate(enabled ? 'teleop' : 'hold')}
                        >
                            Teleoperate
                        </Switch>
                        {state.follower_source === 'policy' ? (
                            <Button variant='primary' isPending={stopTask.isPending} onPress={() => stopTask.mutate()}>
                                <Pause fill='white' />
                                Stop
                            </Button>
                        ) : (
                            <Button
                                variant='primary'
                                isPending={startTask.isPending}
                                onPress={() =>
                                    task.trim() === '' ? setIsEmptyPromptDialogOpen(true) : startTask.mutate(task)
                                }
                            >
                                <Play fill='white' />
                                Play
                            </Button>
                        )}
                    </Flex>
                    <Flex alignItems='end' gap='size-200' wrap>
                        {model?.policy.toLowerCase() === 'act' && (
                            <Flex alignItems='end' gap='size-100' wrap>
                                <NumberField
                                    label='Replan interval (frames)'
                                    aria-label='Replan interval in frames'
                                    value={replanInterval}
                                    minValue={1}
                                    maxValue={100}
                                    step={1}
                                    width='size-2000'
                                    onChange={setReplanIntervalInput}
                                    isDisabled={state.follower_source === 'policy' || setReplanInterval.isPending}
                                />
                                <Button
                                    variant='secondary'
                                    isDisabled={
                                        state.follower_source === 'policy' ||
                                        !Number.isInteger(replanInterval) ||
                                        replanInterval < 1 ||
                                        replanInterval > 100 ||
                                        setReplanInterval.isPending
                                    }
                                    onPress={() => setReplanInterval.mutate(replanInterval)}
                                >
                                    Apply
                                </Button>
                                <Text>Active: {state.replan_interval ?? 'Default (100 frames)'}</Text>
                            </Flex>
                        )}
                        <Button
                            variant='secondary'
                            isPending={startDiagnostics.isPending || stopDiagnostics.isPending}
                            onPress={() =>
                                state.diagnostics_recording ? stopDiagnostics.mutate() : startDiagnostics.mutate()
                            }
                        >
                            {state.diagnostics_recording ? 'Stop diagnostics' : 'Record diagnostics'}
                        </Button>
                        {state.diagnostics_id && model?.id && !state.diagnostics_recording && (
                            <Link href={`/api/models/${model.id}/diagnostics/${state.diagnostics_id}`} target='_blank'>
                                Download CSV
                            </Link>
                        )}
                        {exportUrl !== undefined && (
                            <Button
                                href={exportUrl}
                                aria-label='Download runtime export'
                                variant='secondary'
                                target='_blank'
                                rel='noopener noreferrer'
                            >
                                <DownloadIcon />
                                Runtime export
                            </Button>
                        )}
                    </Flex>
                </Flex>
                <RobotControlView environment={environment} isReady={state.connected} joints={observation} />
            </Flex>
            <DialogContainer onDismiss={() => setIsEmptyPromptDialogOpen(false)}>
                {isEmptyPromptDialogOpen && (
                    <AlertDialog
                        title='Start without a task prompt?'
                        variant='warning'
                        primaryActionLabel='Start anyway'
                        secondaryActionLabel='Cancel'
                        onPrimaryAction={() => {
                            setIsEmptyPromptDialogOpen(false);
                            startTask.mutate(task);
                        }}
                        onSecondaryAction={() => setIsEmptyPromptDialogOpen(false)}
                    >
                        <Text>
                            The task prompt is empty. Policies that follow language instructions, such as Pi0.5, will
                            run without an instruction.
                        </Text>
                    </AlertDialog>
                )}
            </DialogContainer>
        </RobotModelsProvider>
    );
};
