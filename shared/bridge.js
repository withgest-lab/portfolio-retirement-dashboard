/*
 * shared/bridge.js
 * 포트폴리오 대시보드(portfolio/index.html)가 localStorage에 저장한 자산 데이터를 읽어
 * 은퇴 현금흐름 대시보드(retirement/index.html)가 쓸 계좌별 잔액(만원 단위, KRW 환산)으로
 * 집계하는 순수 함수 모음. 외부 네트워크 요청 없음 — 레포 내부 파일로만 로드된다.
 *
 * 이 파일은 두 대시보드가 같은 브라우저 오리진(GitHub Pages)에서 서빙될 때만
 * 의미 있는 값을 반환한다. localStorage 접근이 차단된 환경(예: file:// 단독 실행,
 * 서드파티 iframe 등)에서는 안전하게 빈 값(0)을 반환한다.
 */
(function (global) {
  'use strict';

  var PF_ASSETS_KEY = 'pf_assets_v1';
  var PF_FX_KEY = 'pf_fx_v1';
  var DEFAULT_FX = { USD: 1498.0, JPY: 9.40 };

  function readJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      if (!raw) return fallback;
      var parsed = JSON.parse(raw);
      return parsed == null ? fallback : parsed;
    } catch (e) {
      return fallback;
    }
  }

  function readPortfolioAssets() {
    var parsed = readJSON(PF_ASSETS_KEY, []);
    return Array.isArray(parsed) ? parsed : [];
  }

  function readFX() {
    var parsed = readJSON(PF_FX_KEY, null);
    if (parsed && typeof parsed.USD === 'number' && typeof parsed.JPY === 'number' &&
        parsed.USD > 0 && parsed.JPY > 0) {
      return parsed;
    }
    return DEFAULT_FX;
  }

  // 포트폴리오 대시보드의 evKRW()와 동일한 환산 규칙: currentPrice * quantity * FX
  function assetValueKRW(asset, fx) {
    if (!asset || typeof asset.quantity !== 'number' || typeof asset.currentPrice !== 'number') return 0;
    var rate = 1;
    if (asset.currency === 'USD') rate = fx.USD;
    else if (asset.currency === 'JPY') rate = fx.JPY;
    return asset.currentPrice * asset.quantity * rate;
  }

  /**
   * 포트폴리오 자산을 은퇴 대시보드 계좌 잔액으로 집계한다.
   * 반환 단위: 만원 (은퇴 대시보드 입력 필드와 동일 단위)
   * @returns {{nh:number, mf:number, unclassifiedPersonalPension:number, irp:number, tirp:number, isa:number}}
   */
  function getPortfolioSnapshot() {
    var assets = readPortfolioAssets();
    var fx = readFX();
    var sums = { nh: 0, mf: 0, unclassifiedPersonalPension: 0, irp: 0, tirp: 0, isa: 0 };

    for (var i = 0; i < assets.length; i++) {
      var a = assets[i];
      if (!a) continue;
      var krw = assetValueKRW(a, fx);
      if (krw === 0) continue;

      switch (a.category) {
        case 'pension_personal':
          if (a.subAccount === 'nh') sums.nh += krw;
          else if (a.subAccount === 'mf') sums.mf += krw;
          else sums.unclassifiedPersonalPension += krw;
          break;
        case 'irp':
          sums.irp += krw;
          break;
        case 'pension_retirement':
          sums.tirp += krw;
          break;
        case 'isa':
          sums.isa += krw;
          break;
        default:
          break; // 국내/미국/일본주식, 가상자산, 현금은 은퇴 계좌 잔액과 무관
      }
    }

    var toManwon = function (v) { return Math.round(v / 10000); };
    return {
      nh: toManwon(sums.nh),
      mf: toManwon(sums.mf),
      unclassifiedPersonalPension: toManwon(sums.unclassifiedPersonalPension),
      irp: toManwon(sums.irp),
      tirp: toManwon(sums.tirp),
      isa: toManwon(sums.isa)
    };
  }

  global.PortfolioBridge = { getPortfolioSnapshot: getPortfolioSnapshot };
})(window);
