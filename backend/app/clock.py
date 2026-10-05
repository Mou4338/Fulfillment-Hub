"""Time helpers.

Timestamps are stored as ISO-8601 UTC strings ending in "Z" so they sort
correctly as text and parse unambiguously in the browser.
The clock can be overridden (seed script and tests use this to simulate time).
"""
from datetime import datetime, timedelta, timezone, time
from zoneinfo import ZoneInfo

from . import config

_override: datetime | None = None
TZ = ZoneInfo(config.BUSINESS_TZ)


def set_now(dt: datetime | None) -> None:
    global _override
    _override = dt


def now() -> datetime:
    if _override is not None:
        return _override
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(dt: datetime | None) -> str | None:
    if dt is None:
        return None
    return dt.astimezone(timezone.utc).replace(microsecond=0).strftime("%Y-%m-%dT%H:%M:%SZ")


def parse(s: str | None) -> datetime | None:
    if not s:
        return None
    return datetime.fromisoformat(s.replace("Z", "+00:00"))


def parse_user_date(s: str | None, default_time: str = "11:00") -> datetime | None:
    """A date typed by a person: '2026-10-02' (-> that day at `default_time` local), a local
    '2026-10-02T15:30' (no offset = business time zone) or a full ISO timestamp."""
    if not s:
        return None
    s = s.strip()
    try:
        if len(s) == 10:
            d = datetime.fromisoformat(s)
            return at_local_time(d.replace(tzinfo=TZ), hhmm(default_time))
        dt = datetime.fromisoformat(s.replace("Z", "+00:00"))
    except ValueError:
        return None
    return dt.replace(tzinfo=TZ).astimezone(timezone.utc) if dt.tzinfo is None else dt


def now_iso() -> str:
    return iso(now())


def local(dt: datetime) -> datetime:
    return dt.astimezone(TZ)


def hhmm(s: str) -> time:
    h, m = s.split(":")
    return time(int(h), int(m))


def at_local_time(day_local: datetime, t: time) -> datetime:
    """Return a UTC datetime for local calendar day `day_local` at local time `t`."""
    d = day_local.date()
    return datetime(d.year, d.month, d.day, t.hour, t.minute, tzinfo=TZ).astimezone(timezone.utc)


def next_pickup(pickup_times: list[str], after: datetime) -> datetime:
    """Next courier pickup strictly after `after` (UTC)."""
    base = local(after)
    for day in range(0, 8):
        d = base + timedelta(days=day)
        for t in sorted(pickup_times):
            cand = at_local_time(d, hhmm(t))
            if cand > after:
                return cand
    raise ValueError("courier has no pickup times")


def fmt_local(dt: datetime) -> str:
    """Human label like 'Today 3:00 PM' / 'Tomorrow 11:00 AM' / 'Sat 3:00 PM'."""
    ld = local(dt)
    today = local(now()).date()
    t = ld.strftime("%I:%M %p").lstrip("0")
    if ld.date() == today:
        return f"today {t}"
    if ld.date() == today + timedelta(days=1):
        return f"tomorrow {t}"
    if ld.date() == today - timedelta(days=1):
        return f"yesterday {t}"
    return f"{ld.strftime('%a %d %b')} {t}"
