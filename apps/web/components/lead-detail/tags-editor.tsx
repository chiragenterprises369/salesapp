'use client';

import { Plus, X } from 'lucide-react';
import { useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { Chip } from '@/components/ui/chip';
import { Input } from '@/components/ui/input';
import { KNOWN_TAGS } from '@/components/leads/lead-meta';

/** Tag chips with remove buttons and an add field (suggests workspace tags). */
export function TagsEditor({
  tags,
  editable,
  onChange,
}: {
  tags: string[];
  editable: boolean;
  onChange: (tags: string[]) => Promise<unknown>;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const listId = useId();

  const add = async () => {
    const tag = draft.trim().toLowerCase();
    if (!tag) return setAdding(false);
    if (tag.length > 40) return setError('Tags can be up to 40 characters');
    if (tags.includes(tag)) return setError('This tag is already on the lead');
    setDraft('');
    setError(null);
    await onChange([...tags, tag]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <ul className="flex flex-wrap items-center gap-1.5" aria-label="Tags">
        {tags.length === 0 && !adding && <li className="text-xs text-muted-strong">No tags</li>}
        {tags.map((t) => (
          <li key={t}>
            <Chip size="md" className="pr-1">
              {t}
              {editable && (
                <button
                  type="button"
                  aria-label={`Remove tag ${t}`}
                  onClick={() => void onChange(tags.filter((x) => x !== t))}
                  className="focus-ring inline-flex size-4 items-center justify-center rounded-full hover:bg-surface-3"
                >
                  <X aria-hidden className="size-3" />
                </button>
              )}
            </Chip>
          </li>
        ))}
        {editable && !adding && (
          <li>
            <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
              <Plus aria-hidden />
              Add tag
            </Button>
          </li>
        )}
      </ul>
      {adding && (
        <form
          className="flex items-center gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            void add();
          }}
        >
          <Input
            autoFocus
            data-esc-local
            size="sm"
            list={listId}
            value={draft}
            aria-label="New tag"
            aria-invalid={error ? true : undefined}
            placeholder="e.g. bulk"
            onChange={(e) => {
              setDraft(e.target.value);
              setError(null);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') {
                e.preventDefault();
                e.stopPropagation();
                setAdding(false);
              }
            }}
            className="w-40"
          />
          <datalist id={listId}>
            {KNOWN_TAGS.filter((t) => !tags.includes(t)).map((t) => (
              <option key={t} value={t} />
            ))}
          </datalist>
          <Button size="sm" type="submit">
            Add
          </Button>
          <Button size="sm" variant="ghost" onClick={() => setAdding(false)}>
            Done
          </Button>
        </form>
      )}
      {error && (
        <p role="alert" className="text-xs text-danger-text">
          {error}
        </p>
      )}
    </div>
  );
}
