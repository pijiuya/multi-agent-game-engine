from __future__ import annotations

from math import hypot
from typing import Iterable


def distance(a: dict[str, float], b: dict[str, float]) -> float:
    return hypot(a["x"] - b["x"], a["y"] - b["y"])


def lerp_point(a: dict[str, float], b: dict[str, float], amount: float) -> dict[str, float]:
    return {
        "x": a["x"] + (b["x"] - a["x"]) * amount,
        "y": a["y"] + (b["y"] - a["y"]) * amount,
    }


def point_in_polygon(point: dict[str, float], polygon: Iterable[dict[str, float]]) -> bool:
    """Return True when point is inside a polygon using ray casting."""
    vertices = list(polygon)
    if len(vertices) < 3:
        return False

    x = point["x"]
    y = point["y"]
    inside = False
    j = len(vertices) - 1

    for i, current in enumerate(vertices):
        previous = vertices[j]
        yi = current["y"]
        yj = previous["y"]
        xi = current["x"]
        xj = previous["x"]

        if (yi > y) != (yj > y):
            slope_x = (xj - xi) * (y - yi) / ((yj - yi) or 1e-9) + xi
            if x < slope_x:
                inside = not inside
        j = i

    return inside


def polygon_bounds(points: Iterable[dict[str, float]]) -> dict[str, float]:
    vertices = list(points)
    if not vertices:
        return {"x": 0, "y": 0, "width": 0, "height": 0}
    xs = [p["x"] for p in vertices]
    ys = [p["y"] for p in vertices]
    return {
        "x": min(xs),
        "y": min(ys),
        "width": max(xs) - min(xs),
        "height": max(ys) - min(ys),
    }

