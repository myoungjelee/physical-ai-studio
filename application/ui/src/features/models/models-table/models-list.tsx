import { useMemo, useState } from 'react';

import { DialogContainer, Flex, Item, Picker, Text, TextField } from '@geti-ui/ui';

import { $api } from '../../../api/client';
import { SchemaTrainJob as SchemaJob, SchemaModel } from '../../../api/openapi-spec';
import { Table, TableColumn } from '../../../components/table/table';
import { useProjectId } from '../../projects/use-project';
import { EditModelDialog } from './edit-model-dialog';
import { ModelRow } from './model-row';

const MODEL_COLUMNS: TableColumn[] = [
    { width: 'max-content' },
    { width: '2fr', header: 'Model name / notes' },
    { width: '1fr', header: 'Architecture' },
    { width: '1fr', header: 'Dataset' },
    { width: '1fr', header: 'Environment' },
    { width: '1fr', header: 'Trainer' },
    { width: '1fr', header: 'Trained' },
    { width: '1fr', header: 'Duration' },
    { width: '1fr' },
    { width: 'auto', align: 'end' },
];

interface ModelsListProps {
    models: SchemaModel[];
    jobs: SchemaJob[];
    onRetrain: (model: SchemaModel) => void;
    onViewLogs: (model: SchemaModel) => void;
}

export const ModelsList = ({ models, jobs, onRetrain, onViewLogs }: ModelsListProps) => {
    const [query, setQuery] = useState('');
    const [architecture, setArchitecture] = useState('all');
    const [tag, setTag] = useState('all');
    const [sort, setSort] = useState('newest');
    const [editingModel, setEditingModel] = useState<SchemaModel | null>(null);
    const architectures = [...new Set(models.map((model) => model.policy))].sort();
    const tags = [...new Set(models.flatMap((model) => model.tags ?? []))].sort();
    const sortedModels = useMemo(() => {
        const search = query.trim().toLocaleLowerCase();
        const result = models.filter((model) => {
            const matchesText = [model.name, model.description ?? '', ...(model.tags ?? [])].some((value) =>
                value.toLocaleLowerCase().includes(search)
            );
            return (
                matchesText &&
                (architecture === 'all' || model.policy === architecture) &&
                (tag === 'all' || (model.tags ?? []).includes(tag))
            );
        });
        return result.sort((a, b) => {
            if (sort === 'name') return a.name.localeCompare(b.name);
            if (sort === 'version') return (b.version ?? 1) - (a.version ?? 1);
            const diff = new Date(b.created_at ?? 0).getTime() - new Date(a.created_at ?? 0).getTime();
            return sort === 'oldest' ? -diff : diff;
        });
    }, [models, query, architecture, tag, sort]);

    const jobsById = new Map(jobs.map((j) => [j.id, j]));

    const { project_id } = useProjectId();
    const deleteModelMutation = $api.useMutation('delete', '/api/models/{model_id}', {
        meta: {
            invalidates: [['get', '/api/projects/{project_id}/models', { params: { path: { project_id } } }]],
        },
    });

    const deleteModel = (model: SchemaModel) => {
        deleteModelMutation.mutate({ params: { path: { model_id: model.id! } } });
    };

    return (
        <Flex direction='column' gap='size-200'>
            <Flex gap='size-200' alignItems='end' wrap>
                <TextField label='Search models' value={query} onChange={setQuery} />
                <Picker
                    label='Architecture'
                    selectedKey={architecture}
                    onSelectionChange={(key) => setArchitecture(String(key ?? 'all'))}
                    items={[
                        { id: 'all', label: 'All architectures' },
                        ...architectures.map((value) => ({
                            id: value,
                            label: value.toUpperCase(),
                        })),
                    ]}
                >
                    {(option) => <Item key={option.id}>{option.label}</Item>}
                </Picker>
                <Picker
                    label='Tag'
                    selectedKey={tag}
                    onSelectionChange={(key) => setTag(String(key ?? 'all'))}
                    items={[{ id: 'all', label: 'All tags' }, ...tags.map((value) => ({ id: value, label: value }))]}
                >
                    {(option) => <Item key={option.id}>{option.label}</Item>}
                </Picker>
                <Picker label='Sort' selectedKey={sort} onSelectionChange={(key) => setSort(String(key ?? 'newest'))}>
                    <Item key='newest'>Newest first</Item>
                    <Item key='oldest'>Oldest first</Item>
                    <Item key='name'>Name A–Z</Item>
                    <Item key='version'>Highest version</Item>
                </Picker>
                <Text>
                    {sortedModels.length} / {models.length} models
                </Text>
            </Flex>
            <Table columns={MODEL_COLUMNS}>
                {sortedModels.map((model) => (
                    <ModelRow
                        key={model.id}
                        model={model}
                        trainingJob={model.train_job_id ? jobsById.get(model.train_job_id) : undefined}
                        onDelete={() => deleteModel(model)}
                        onRetrain={() => onRetrain(model)}
                        onViewLogs={() => onViewLogs(model)}
                        onEdit={() => setEditingModel(model)}
                    />
                ))}
            </Table>
            <DialogContainer onDismiss={() => setEditingModel(null)}>
                {editingModel && <EditModelDialog model={editingModel} onClose={() => setEditingModel(null)} />}
            </DialogContainer>
        </Flex>
    );
};
