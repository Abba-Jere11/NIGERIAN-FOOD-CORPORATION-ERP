'use client';

import { useTransition } from 'react';
import type { DevActorSummaryView, MeView } from '@nfc/shared';
import { selectActor } from '@/app/actions';

/**
 * Switches the acting identity.
 *
 * This exists only because M1 has no authentication. It is the visible part of
 * the declared dev-actor bridge: choosing an actor sets a cookie, and the API
 * then resolves that actor's role and scope and enforces them server-side. M2
 * replaces it with a real sign-in and removes this component.
 */
export function ActorSwitcher({
  me,
  actors,
  selectedKey,
}: {
  me: MeView;
  actors: DevActorSummaryView[];
  selectedKey: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <div className="no-print flex items-center gap-2">
      <div className="hidden text-right leading-tight sm:block">
        <p className="text-[13px] font-medium text-white">{me.name}</p>
        <p className="text-[11px] text-white/70">
          {me.roleShortName}
          {me.isCorporate
            ? ' \u00B7 Corporate'
            : me.entities[0]
              ? ` \u00B7 ${me.entities[0].code}`
              : ''}
        </p>
      </div>

      <label className="sr-only" htmlFor="actor-switcher">
        Acting as
      </label>
      <select
        id="actor-switcher"
        value={selectedKey}
        disabled={pending}
        onChange={(event) => {
          const key = event.target.value;
          startTransition(async () => {
            await selectActor(key);
          });
        }}
        className="h-8 max-w-[15rem] border border-white/25 bg-accent-800 px-2 text-[12px] text-white"
      >
        {actors.map((actor) => (
          <option key={actor.key} value={actor.key}>
            {actor.roleShortName}
            {actor.entityCode ? ` \u2014 ${actor.entityCode}` : ' \u2014 Corporate'} ({actor.name})
          </option>
        ))}
      </select>
    </div>
  );
}
