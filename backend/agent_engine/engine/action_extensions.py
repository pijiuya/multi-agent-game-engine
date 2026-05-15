from __future__ import annotations

import ast
from dataclasses import dataclass
from inspect import signature
from typing import Any, Callable


class ActionExtensionError(ValueError):
    """Raised when a local action extension cannot be safely loaded."""


@dataclass(slots=True)
class ActionExtension:
    id: str
    name: str
    type: str
    description: str
    payload_schema: dict[str, Any]
    permissions: list[str]
    enabled: bool
    code: str
    validate_fn: Callable[..., Any]
    apply_fn: Callable[..., Any]

    def action_definition(self) -> dict[str, Any]:
        return {
            "type": self.type,
            "description": self.description,
            "payload_schema": self.payload_schema,
            "permissions": self.permissions,
            "source": "extension",
        }

    def definition(self) -> dict[str, Any]:
        return self.action_definition()

    def to_dict(self, include_code: bool = True) -> dict[str, Any]:
        payload: dict[str, Any] = {
            "id": self.id,
            "name": self.name,
            "type": self.type,
            "action_type": self.type,
            "description": self.description,
            "payload_schema": self.payload_schema,
            "permissions": self.permissions,
            "enabled": self.enabled,
            "check": _check_payload(self),
        }
        if include_code:
            payload["code"] = self.code
        return payload


DANGEROUS_NODES = (ast.Global, ast.Nonlocal)
DANGEROUS_NAMES = {
    "__import__",
    "breakpoint",
    "compile",
    "eval",
    "exec",
    "globals",
    "input",
    "locals",
    "open",
    "setattr",
    "delattr",
    "getattr",
    "vars",
    "memoryview",
}
DANGEROUS_ROOT_NAMES = {
    "asyncio",
    "builtins",
    "ctypes",
    "importlib",
    "inspect",
    "io",
    "multiprocessing",
    "os",
    "pathlib",
    "requests",
    "shutil",
    "socket",
    "subprocess",
    "sys",
    "threading",
    "urllib",
}
DANGEROUS_ATTRIBUTES = {
    "__class__",
    "__dict__",
    "__globals__",
    "__mro__",
    "__subclasses__",
    "__getattribute__",
}
SAFE_BUILTINS = {
    "abs": abs,
    "all": all,
    "any": any,
    "bool": bool,
    "dict": dict,
    "enumerate": enumerate,
    "float": float,
    "int": int,
    "isinstance": isinstance,
    "len": len,
    "list": list,
    "max": max,
    "min": min,
    "pow": pow,
    "range": range,
    "round": round,
    "set": set,
    "str": str,
    "sum": sum,
    "tuple": tuple,
    "Exception": Exception,
    "TypeError": TypeError,
    "ValueError": ValueError,
}


def normalize_action_extension_record(data: dict[str, Any]) -> dict[str, Any]:
    action = data.get("action") if isinstance(data.get("action"), dict) else {}
    action_type = str(data.get("type") or data.get("action_type") or action.get("type") or "").strip()
    return {
        "id": str(data.get("id") or "").strip(),
        "name": str(data.get("name") or action.get("name") or action_type).strip(),
        "type": action_type,
        "description": str(data.get("description") or action.get("description") or "").strip(),
        "payload_schema": _dict_or_empty(data.get("payload_schema") or action.get("payload_schema")),
        "permissions": _string_list(data.get("permissions") or action.get("permissions")),
        "enabled": bool(data.get("enabled", True)),
        "code": str(data.get("code") or ""),
    }


def check_action_extension_code(
    code: str,
    *,
    extension_id: str = "",
    name: str = "",
    enabled: bool = True,
) -> dict[str, Any]:
    try:
        extension = _load_action_extension(
            code,
            extension_id=extension_id,
            name=name,
            enabled=enabled,
        )
    except ActionExtensionError as exc:
        return {
            "ok": False,
            "action": {},
            "action_type": "",
            "type": "",
            "description": "",
            "payload_schema": {},
            "permissions": [],
            "issues": [{"severity": "blocker", "message": str(exc), "line": None}],
            "errors": [str(exc)],
        }
    return _check_payload(extension)


def compile_action_extension(record: dict[str, Any]) -> ActionExtension:
    normalized = normalize_action_extension_record(record)
    return _load_action_extension(
        normalized["code"],
        extension_id=normalized["id"],
        name=normalized["name"],
        enabled=normalized["enabled"],
    )


def compile_action_extensions(records: list[dict[str, Any]]) -> list[ActionExtension]:
    extensions: list[ActionExtension] = []
    for record in records:
        if not isinstance(record, dict):
            continue
        try:
            extensions.append(compile_action_extension(record))
        except ActionExtensionError:
            continue
    return extensions


def public_action_extension(record: dict[str, Any]) -> dict[str, Any]:
    return compile_action_extension(record).to_dict()


def validate_extension_result(result: Any) -> tuple[bool, str]:
    if isinstance(result, tuple) and result:
        ok = bool(result[0])
        message = str(result[1]) if len(result) > 1 else ("accepted" if ok else "rejected")
        return ok, message
    if isinstance(result, dict):
        ok = bool(result.get("ok", True))
        return ok, str(result.get("message") or ("accepted" if ok else "rejected"))
    if isinstance(result, bool):
        return result, "accepted" if result else "rejected"
    if isinstance(result, str):
        return True, result
    return bool(result is None or result), "accepted"


def validate_extension_action(extension: ActionExtension, world: Any, action: Any) -> tuple[bool, str]:
    try:
        return validate_extension_result(_call_extension_fn(extension.validate_fn, world, action))
    except Exception as exc:
        return False, f"{extension.type} validate failed: {exc}"


def apply_extension_action(extension: ActionExtension, world: Any, action: Any) -> tuple[bool, str, dict[str, Any] | None]:
    try:
        result = _call_extension_fn(extension.apply_fn, world, action)
    except Exception as exc:
        return False, f"{extension.type} apply failed: {exc}", None
    profile = world.agent_profiles.get(action.agent_id)
    state = world.agent_states.get(action.agent_id)
    agent_name = profile.name if profile is not None else action.agent_id
    message = f"{agent_name} performs {extension.type}."
    event_type = "extension_action"
    payload: dict[str, Any] = {"action": action.to_dict(), "extension_id": extension.id}
    status = extension.type
    if isinstance(result, dict):
        if result.get("ok") is False:
            return False, str(result.get("message") or f"{extension.type} rejected"), None
        message = str(result.get("message") or message)
        event_type = str(result.get("event_type") or event_type)
        if isinstance(result.get("payload"), dict):
            payload.update(result["payload"])
        status = str(result.get("status") or result.get("animation_state") or status)
        if isinstance(result.get("event"), dict):
            if state is not None:
                state.status = status
            return True, message, dict(result["event"])
    elif isinstance(result, str):
        message = result
    if state is not None:
        state.status = status
    event = world.add_event(event_type, message, agent_id=action.agent_id, payload=payload)
    return True, message, event.to_dict()


def _load_action_extension(
    code: str,
    *,
    extension_id: str = "",
    name: str = "",
    enabled: bool = True,
) -> ActionExtension:
    namespace = _execute_checked_code(code)
    action = namespace.get("ACTION")
    if not isinstance(action, dict):
        raise ActionExtensionError("Extension must define ACTION as a dict.")
    action_type = str(action.get("type") or "").strip()
    if not action_type:
        raise ActionExtensionError("ACTION.type is required.")
    if not _valid_action_type(action_type):
        raise ActionExtensionError("ACTION.type may only contain letters, numbers, underscore, dash, or colon.")
    validate = namespace.get("validate")
    apply = namespace.get("apply")
    if not callable(validate):
        raise ActionExtensionError("Extension must define validate(world, agent_id, payload).")
    if not callable(apply):
        raise ActionExtensionError("Extension must define apply(world, agent_id, payload).")
    return ActionExtension(
        id=extension_id,
        name=(name or str(action.get("name") or action_type)).strip(),
        type=action_type,
        description=str(action.get("description") or "").strip(),
        payload_schema=_dict_or_empty(action.get("payload_schema")),
        permissions=_string_list(action.get("permissions")),
        enabled=bool(enabled),
        code=code,
        validate_fn=validate,
        apply_fn=apply,
    )


def _call_extension_fn(func: Callable[..., Any], world: Any, action: Any) -> Any:
    try:
        parameters = list(signature(func).parameters.values())
        required_positional = [
            parameter
            for parameter in parameters
            if parameter.kind in {parameter.POSITIONAL_ONLY, parameter.POSITIONAL_OR_KEYWORD}
            and parameter.default is parameter.empty
        ]
    except (TypeError, ValueError):
        required_positional = []
    if len(required_positional) <= 2:
        return func(world, action)
    return func(world, action.agent_id, dict(action.payload))


def _execute_checked_code(code: str) -> dict[str, Any]:
    try:
        tree = ast.parse(code)
    except SyntaxError as exc:
        raise ActionExtensionError(f"Python syntax error: {exc.msg}") from exc
    _check_ast(tree)
    namespace: dict[str, Any] = {"__builtins__": SAFE_BUILTINS}
    try:
        exec(compile(tree, "<action_extension>", "exec"), namespace, namespace)
    except Exception as exc:
        raise ActionExtensionError(f"Extension load failed: {exc}") from exc
    return namespace


def _check_ast(tree: ast.AST) -> None:
    for node in ast.walk(tree):
        if isinstance(node, (ast.Import, ast.ImportFrom)):
            raise ActionExtensionError("Imports are not allowed.")
        if isinstance(node, DANGEROUS_NODES):
            raise ActionExtensionError("Global/nonlocal declarations are not allowed.")
        if isinstance(node, ast.Name):
            if node.id.startswith("__") or node.id in DANGEROUS_NAMES or node.id in DANGEROUS_ROOT_NAMES:
                raise ActionExtensionError(f"Use of {node.id} is not allowed.")
        if isinstance(node, ast.Attribute):
            if node.attr.startswith("__") or node.attr in DANGEROUS_ATTRIBUTES:
                raise ActionExtensionError(f"Access to attribute {node.attr} is not allowed.")
        if isinstance(node, ast.Call):
            func = node.func
            if isinstance(func, ast.Name) and func.id in DANGEROUS_NAMES:
                raise ActionExtensionError(f"Call to {func.id} is not allowed.")
            if isinstance(func, ast.Attribute) and (func.attr.startswith("__") or func.attr in DANGEROUS_ATTRIBUTES):
                raise ActionExtensionError(f"Call to attribute {func.attr} is not allowed.")


def _check_payload(extension: ActionExtension) -> dict[str, Any]:
    action = {
        "type": extension.type,
        "description": extension.description,
        "payload_schema": extension.payload_schema,
        "permissions": extension.permissions,
    }
    return {
        "ok": True,
        "action": action,
        "action_type": extension.type,
        "type": extension.type,
        "description": extension.description,
        "payload_schema": extension.payload_schema,
        "permissions": extension.permissions,
        "issues": [],
        "errors": [],
    }


def _dict_or_empty(value: Any) -> dict[str, Any]:
    return dict(value) if isinstance(value, dict) else {}


def _string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return [str(item) for item in value if str(item).strip()]


def _valid_action_type(value: str) -> bool:
    return 1 <= len(value) <= 64 and all(char.isalnum() or char in {"_", "-", ":"} for char in value)
