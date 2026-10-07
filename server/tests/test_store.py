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


def test_removing_a_record_frees_only_the_files_nothing_else_uses():
    car = {"id": "c1", "photo": "/media/a.jpg", "photos": ["/media/a.jpg", "/media/b.jpg"],
           "capture": {"splat": "/media/captures/j1/car.ply", "video": "/media/v.mov"}, "nickname": "not a file"}
    rest = {"cars": [], "spotted": [{"id": "s1", "photo": "/media/a.jpg"}]}  # the Spotted entry shares the photo
    assert store.orphaned_files(car, rest) == {"/media/b.jpg", "/media/captures/j1/car.ply", "/media/v.mov"}
