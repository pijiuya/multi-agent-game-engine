from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any

from .world import GameWorld


ALLOWED_EVENT_TYPES = {"environment", "narration", "weather", "hint", "system"}
ALLOWED_ITEM_STATE_KEYS = {"label", "enabled", "mood", "description"}


@dataclass(slots=True)
class ProposalReview:
    accepted: list[dict[str, Any]] = field(default_factory=list)
    rejected: list[dict[str, Any]] = field(default_factory=list)


class EnvironmentArbiter:
    """Accepts only safe Game Master model proposals and records rejected patches."""

    def apply_proposal(self, world: GameWorld, proposal: dict[str, Any]) -> ProposalReview:
        review = ProposalReview()

        for event in proposal.get("events", []):
            event_type = str(event.get("type", "environment"))
            message = str(event.get("message", "")).strip()
            if event_type in ALLOWED_EVENT_TYPES and message:
                created = world.add_event(
                    event_type,
                    message,
                    agent_id=event.get("agent_id"),
                    payload=dict(event.get("payload", {})),
                )
                review.accepted.append({"kind": "event", "event": created.to_dict()})
            else:
                review.rejected.append({"kind": "event", "reason": "unsafe event", "value": event})

        for patch in proposal.get("state_changes", []):
            if self._apply_item_patch(world, patch):
                review.accepted.append({"kind": "state_change", "value": patch})
            else:
                review.rejected.append({"kind": "state_change", "reason": "unsafe patch", "value": patch})

        if review.rejected:
            world.add_event(
                "system",
                f"Environment proposal rejected {len(review.rejected)} unsafe change(s).",
                payload={"rejected": review.rejected},
            )
        return review

    def _apply_item_patch(self, world: GameWorld, patch: dict[str, Any]) -> bool:
        if patch.get("op") != "set_item_state":
            return False
        item_id = str(patch.get("item_id", ""))
        key = str(patch.get("key", ""))
        if key not in ALLOWED_ITEM_STATE_KEYS:
            return False
        item = world.map.item_by_id(item_id)
        if item is None:
            return False
        item.state[key] = patch.get("value")
        return True

