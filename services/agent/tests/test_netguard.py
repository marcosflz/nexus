import pytest

from nexus_agent.htmltext import html_to_text
from nexus_agent.netguard import BlockedUrl, check_url, is_blocked_address


def resolver_for(mapping):
    async def resolve(host):
        if host not in mapping:
            raise OSError("NXDOMAIN")
        return mapping[host]

    return resolve


PUBLIC = resolver_for({"example.com": ["93.184.216.34"], "rebind.test": ["8.8.8.8", "10.0.0.5"]})


async def test_allows_public_https_urls():
    assert await check_url("https://example.com/a?b=1", PUBLIC) == "https://example.com/a?b=1"


@pytest.mark.parametrize(
    "url",
    [
        "http://localhost:3000",
        "http://127.0.0.1/",
        "http://[::1]/",
        "http://10.0.0.1/",
        "http://192.168.1.10/",
        "http://172.16.0.1/",
        "http://169.254.169.254/latest/meta-data",
        "http://metadata.google.internal/",
        "http://printer.local/",
        "http://0.0.0.0/",
        "http://[::ffff:127.0.0.1]/",
        "ftp://example.com/",
        "file:///etc/passwd",
        "http://user:pass@example.com/",
        "http:///sin-host",
    ],
)
async def test_blocks_local_and_malformed_targets(url):
    with pytest.raises(BlockedUrl):
        await check_url(url, PUBLIC)


async def test_blocks_a_public_name_that_resolves_to_a_private_address():
    # Un solo registro privado entre varios basta para rechazar.
    with pytest.raises(BlockedUrl, match="privada"):
        await check_url("https://rebind.test/", PUBLIC)


async def test_unresolvable_hosts_are_rejected():
    with pytest.raises(BlockedUrl, match="resolver"):
        await check_url("https://no-existe.test/", PUBLIC)


def test_address_classification():
    assert is_blocked_address("10.1.2.3") and is_blocked_address("fe80::1")
    assert not is_blocked_address("8.8.8.8")
    assert is_blocked_address("no-es-ip")


def test_html_to_text_drops_scripts_and_keeps_structure():
    html = (
        "<html><head><title> Mi  página </title><style>p{}</style></head>"
        "<body><script>alert(1)</script><h1>Hola</h1><p>Un   párrafo</p>"
        "<ul><li>uno</li><li>dos</li></ul></body></html>"
    )
    title, text = html_to_text(html)
    assert title == "Mi página"
    assert "alert" not in text and "p{}" not in text
    assert text == "Hola\n\nUn párrafo\n\nuno\ndos"
