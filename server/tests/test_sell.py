from garage.sell import _page


def test_the_listing_page_escapes_what_people_typed():
    car = {"identity": {"make": "Toyota", "model": "Camry", "yearFrom": 2019, "yearTo": 2019, "year": 2019},
           "nickname": "<script>alert(1)</script>"}
    sell = {"useNickname": True, "listing": "Great car <img src=x onerror=alert(1)>\n\nSecond paragraph", "price": 18500}
    html = _page(car, sell, None, ["photos/01.jpg"], False)
    assert "<script>alert" not in html and "<img src=x" not in html
    assert "&lt;script&gt;" in html and "$18,500" in html
    assert html.count("<p>") >= 2  # paragraphs kept


def test_no_viewer_scripts_without_a_3d_model():
    car = {"identity": {"make": "Toyota", "model": "Camry", "yearFrom": 2019, "yearTo": 2019}}
    html = _page(car, {}, None, [], False)
    assert "importmap" not in html and "viewer.js" not in html
