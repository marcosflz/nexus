import pytest

from nexus_agent.security import AuthError, sign, verify

SECRET = "s3cret"
BODY = b'{"a":1}'


def headers(ts="1000", body=BODY, secret=SECRET):
    return f"Bearer {secret}", ts, sign(secret, ts, body)


def test_accepts_a_valid_signed_request():
    auth, ts, sig = headers()
    verify(SECRET, auth, ts, sig, BODY, now=1010)


@pytest.mark.parametrize("mutation", ["secret", "body", "signature", "expired", "missing"])
def test_rejects_tampering(mutation):
    auth, ts, sig = headers()
    body, now = BODY, 1010
    if mutation == "secret":
        auth = "Bearer otro"
    elif mutation == "body":
        body = b'{"a":2}'
    elif mutation == "signature":
        sig = "0" * 64
    elif mutation == "expired":
        now = 1000 + 61
    elif mutation == "missing":
        sig = None
    with pytest.raises(AuthError):
        verify(SECRET, auth, ts, sig, body, now=now)


def test_refuses_to_run_without_a_configured_secret():
    with pytest.raises(AuthError, match="NEXUS_AGENT_SECRET"):
        verify("", "Bearer ", "1", "x", BODY)
