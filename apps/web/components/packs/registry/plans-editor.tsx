'use client';

import { formatInr, PLANS, type Plan, type SuperPack } from '@vistar/shared';
import { useState, type FormEvent } from 'react';
import { CheckboxRow } from '@/components/settings/common/checkbox';
import { errorMessage, InlineAlert } from '@/components/settings/common/states';
import { SaveBar, SettingsCard } from '@/components/settings/settings-card';
import { PLAN_LABELS } from '@/components/packs/industry/pack-meta';
import { FormField, Input } from '@/components/ui/input';
import { toast } from '@/components/ui/toast';
import { fieldErrorMap } from '@/lib/customization';
import { useSetPackPlans } from '@/lib/packs';

const sameSet = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x) => b.includes(x));

/** Plans that include the pack + monthly add-on price (whole rupees). Core packs are in every plan. Remount per pack. */
export function PlansEditor({ pack }: { pack: SuperPack }) {
  const save = useSetPackPlans();
  const [plans, setPlans] = useState<Plan[]>(pack.plans);
  const [price, setPrice] = useState(pack.priceInrMonthly === null ? '' : String(pack.priceInrMonthly));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const storedPrice = pack.priceInrMonthly === null ? '' : String(pack.priceInrMonthly);
  const dirty = !sameSet(plans, pack.plans) || price.trim() !== storedPrice;
  const locked = pack.core;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setFormError(null);
    const p = price.trim() === '' ? null : Number(price);
    if (p !== null && (!Number.isInteger(p) || p < 0 || p > 1_000_000)) {
      setErrors({ priceInrMonthly: 'Enter whole rupees from 0 to 10,00,000, or leave it empty' });
      return;
    }
    setErrors({});
    try {
      await save.mutateAsync({ key: pack.key, body: { plans, priceInrMonthly: p } });
      toast.success(`Plans saved for ${pack.name}`);
    } catch (err) {
      setErrors(fieldErrorMap(err));
      setFormError(errorMessage(err));
    }
  }

  return (
    <form onSubmit={onSubmit} noValidate>
      <SettingsCard
        title="Plans and price"
        description="Which plans include the pack, and the monthly add-on price for companies on other plans."
        footer={
          <SaveBar
            dirty={dirty}
            saving={save.isPending}
            onDiscard={() => {
              setPlans(pack.plans);
              setPrice(storedPrice);
            }}
            readOnlyReason={locked ? 'Core packs are included in every plan.' : null}
            label="Save plans"
          />
        }
      >
        <div className="flex flex-col gap-4">
          {formError && <InlineAlert>{formError}</InlineAlert>}
          <fieldset disabled={locked}>
            <legend className="mb-1 text-xs font-medium text-fg-secondary">Included in plans</legend>
            <div className="grid grid-cols-2 sm:grid-cols-4">
              {PLANS.map((plan) => (
                <CheckboxRow
                  key={plan}
                  checked={plans.includes(plan)}
                  onCheckedChange={(on) => setPlans((all) => (on ? [...all, plan] : all.filter((x) => x !== plan)))}
                  label={PLAN_LABELS[plan]}
                  disabled={locked}
                />
              ))}
            </div>
            {!locked && plans.length === 0 && <p className="mt-1 text-xs text-muted">No plan includes it: only companies you grant can use it.</p>}
          </fieldset>
          <div className="max-w-xs">
            <FormField
              label="Add-on price per month (₹)"
              error={errors.priceInrMonthly}
              hint={price.trim() && Number.isFinite(Number(price)) ? `${formatInr(Number(price))} per company per month` : 'Leave empty if it is not sold separately'}
            >
              <Input type="number" inputMode="numeric" min={0} step={1} value={price} onChange={(e) => setPrice(e.target.value)} disabled={locked} />
            </FormField>
          </div>
        </div>
      </SettingsCard>
    </form>
  );
}
