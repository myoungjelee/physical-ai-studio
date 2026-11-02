import { useState } from 'react';

import {
    Button,
    ButtonGroup,
    Content,
    Dialog,
    Divider,
    FileTrigger,
    Flex,
    Heading,
    Item,
    Picker,
    Text,
    TextField,
} from '@geti-ui/ui';
import { useQueryClient } from '@tanstack/react-query';

import { useProject } from '../projects/use-project';

interface ImportModelDialogProps {
    onClose: () => void;
}

export const ImportModelDialog = ({ onClose }: ImportModelDialogProps) => {
    const project = useProject();
    const queryClient = useQueryClient();
    const [file, setFile] = useState<File | null>(null);
    const [name, setName] = useState('');
    const [datasetId, setDatasetId] = useState<string>(
        project.datasets.length === 1 ? (project.datasets[0]?.id ?? '') : ''
    );
    const [uploading, setUploading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    const importModel = async () => {
        if (!file || !name.trim() || !datasetId || uploading) return;
        setUploading(true);
        setError(null);
        try {
            const form = new FormData();
            form.append('project_id', project.id);
            form.append('dataset_id', datasetId);
            form.append('model_name', name.trim());
            form.append('archive', file);

            const response = await fetch('/api/models/import', { method: 'POST', body: form });
            if (!response.ok) {
                const data = (await response.json().catch(() => ({}))) as { detail?: string };
                throw new Error(
                    typeof data.detail === 'string' ? data.detail : `Model import failed (${response.status})`
                );
            }
            // The model list uses the shared OpenAPI query cache.
            await queryClient.invalidateQueries();
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Model import failed');
        } finally {
            setUploading(false);
        }
    };

    return (
        <Dialog>
            <Heading>Import model</Heading>
            <Divider />
            <Content>
                <Flex direction='column' gap='size-200' width='100%'>
                    <Text>Select a model ZIP exported by Physical AI Studio.</Text>
                    <FileTrigger
                        acceptedFileTypes={['.zip']}
                        onSelect={(files) => {
                            const selected = files?.item(0);
                            if (!selected) return;
                            setFile(selected);
                            setName(selected.name.replace(/\.zip$/i, ''));
                            setError(null);
                        }}
                    >
                        <Button variant='secondary'>Choose ZIP file</Button>
                    </FileTrigger>
                    {file && <Text>{file.name}</Text>}
                    <TextField label='Model name' value={name} onChange={setName} isRequired />
                    <Picker
                        label='Link to local dataset'
                        selectedKey={datasetId || null}
                        onSelectionChange={(key) => setDatasetId(key === null ? '' : String(key))}
                        width='100%'
                        isRequired
                    >
                        {project.datasets.map((dataset) => (
                            <Item key={dataset.id}>{dataset.name}</Item>
                        ))}
                    </Picker>
                    <Text>Choose a dataset with a compatible robot setup (state, actions, and cameras). The original training dataset is not included in the ZIP.</Text>
                    {error && <Text>{error}</Text>}
                    {uploading && <Text>Uploading and validating model... Please keep this window open.</Text>}
                </Flex>
            </Content>
            <ButtonGroup>
                <Button
                    variant='accent'
                    onPress={importModel}
                    isDisabled={uploading || !file || !name.trim() || !datasetId}
                >
                    {uploading ? 'Importing...' : 'Import model'}
                </Button>
                <Button variant='secondary' onPress={onClose} isDisabled={uploading}>
                    Cancel
                </Button>
            </ButtonGroup>
        </Dialog>
    );
};
