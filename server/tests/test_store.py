from garage import store
from garage.paths import MEDIA


def test_media_urls_map_into_the_media_folder():
    assert store.media_path("/media/ab12.jpg") == (MEDIA / "ab12.jpg").resolve()
    assert store.media_path("/media/studio/x.jpg") == (MEDIA / "studio" / "x.jpg").resolve()


def test_paths_cannot_leave_the_media_folder():
    for url in ("/media/../garage.json", "/media/studio/../../garage.json", "/media/../../../etc/passwd"):
        path = store.media_path(url)
        assert not path.exists()
        assert MEDIA.resolve() in path.parents
