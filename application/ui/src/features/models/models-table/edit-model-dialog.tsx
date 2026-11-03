import { useState } from 'react';

import { Button, ButtonGroup, Content, Dialog, Divider, Flex, Heading, Text, TextArea, TextField } from '@geti-ui/ui';
import { useQueryClient } from '@tanstack/react-query';

import type { SchemaModel } from '../../../api/openapi-spec';

export const EditModelDialog = ({ model, onClose }: { model: SchemaModel; onClose: () => void }) => {
    const [name, setName] = useState(model.name);
    const [description, setDescription] = useState(model.description ?? '');
    const [tagsText, setTagsText] = useState((model.tags ?? []).join(', '));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const queryClient = useQueryClient();

    const tags = tagsText
        .split(',')
        .map((tag) => tag.trim())
        .filter(Boolean);
    const tagsAreValid =
        tags.length <= 10 &&
        tags.every((tag) => tag.length <= 40) &&
        new Set(tags.map((tag) => tag.toLocaleLowerCase())).size === tags.length;
    const valid = name.trim().length > 0 && name.trim().length <= 200 && description.length <= 2000 && tagsAreValid;

    const save = async () => {
        if (!valid || saving) return;
        setSaving(true);
        setError(null);
        try {
            const response = await fetch(`/api/models/${model.id}`, {
                method: 'PATCH',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name: name.trim(), description, tags }),
            });
            if (!response.ok) {
                const body = (await response.json().catch(() => ({}))) as {
                    detail?: unknown;
                };
                throw new Error(
                    typeof body.detail === 'string' ? body.detail : `Model update failed (${response.status})`
                );
            }
            await queryClient.invalidateQueries();
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : 'Model update failed');
        } finally {
            setSaving(false);
        }
    };

    return (
        <Dialog>
            <Heading>Edit model</Heading>
            <Divider />
            <Content>
                <Flex direction='column' gap='size-200' width='100%'>
                    <TextField label='Model name' width='100%' isRequired value={name} onChange={setName} />
                    <TextArea label='Description' width='100%' value={description} onChange={setDescription} />
                    <TextField label='Tags (comma separated)' width='100%' value={tagsText} onChange={setTagsText} />
                    <Text>Version v{model.version ?? 1} is managed by retraining and cannot be edited.</Text>
                    {!tagsAreValid && <Text>Use up to 10 unique tags, each 1–40 characters long.</Text>}
                    {error && <Text>{error}</Text>}
                </Flex>
            </Content>
            <ButtonGroup>
                <Button variant='secondary' onPress={onClose} isDisabled={saving}>
                    Cancel
                </Button>
                <Button variant='accent' onPress={save} isDisabled={!valid || saving}>
                    {saving ? 'Saving...' : 'Save'}
                </Button>
            </ButtonGroup>
        </Dialog>
    );
};
