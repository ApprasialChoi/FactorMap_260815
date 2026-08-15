/**
 * kakao_base.js - 카카오맵 베이스 레이어 (Leaflet 동기화)
 * initKakaoBaseMap(leafletMap, options) 호출로 사용
 */
function initKakaoBaseMap(leafletMap, options) {
    options = options || {};
    var mapTypeId = options.mapTypeId || 'ROADMAP';

    var kakaoDiv = document.getElementById('kakao-map');
    if (!kakaoDiv) return;

    var center = leafletMap.getCenter();
    var kakaoMap = new kakao.maps.Map(kakaoDiv, {
        center: new kakao.maps.LatLng(center.lat, center.lng),
        level: leafletZoomToKakaoLevel(leafletMap.getZoom())
    });

    // Leaflet → 카카오 동기화
    function syncKakao() {
        var c = leafletMap.getCenter();
        var level = leafletZoomToKakaoLevel(leafletMap.getZoom());
        kakaoMap.setCenter(new kakao.maps.LatLng(c.lat, c.lng));
        kakaoMap.setLevel(level);
    }

    leafletMap.on('move zoom moveend zoomend resize', syncKakao);

    // 줌 변환: Leaflet zoom → 카카오 level
    function leafletZoomToKakaoLevel(zoom) {
        // Leaflet zoom 7~19 → Kakao level 약 10~1
        var level = Math.max(1, Math.min(14, Math.round(21 - zoom * 1.1)));
        return level;
    }

    // 전역에 저장
    window.kakaoMap = kakaoMap;

    // 지적편집도 등 오버레이용
    if (kakaoMap.addOverlayMapTypeId) {
        // 필요 시 외부에서 kakaoMap.addOverlayMapTypeId(kakao.maps.MapTypeId.USE_DISTRICT) 호출
    }

    return kakaoMap;
}
