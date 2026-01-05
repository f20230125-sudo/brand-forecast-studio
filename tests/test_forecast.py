import math

import numpy as np
import pandas as pd
import pytest
from pydantic import ValidationError

from bf import health, model, scenario


@pytest.fixture(scope="module")
def panel():
    df = model.load_panel()
    units, spend, price = model.wide(df)
    return df, units, spend, price, model.info(df)


def test_quarter_index_round_trips():
    for y in (2019, 2023, 2025):
        for q in (1, 2, 3, 4):
            assert model.qlabel(model.qindex(y, q)) == f"{y}Q{q}"


def test_panel_covers_every_msd_business_unit(panel):
    df = panel[0]
    msd = df[df.owner == "Merck (MSD)"]
    assert set(msd.bu) == {"Oncology", "Diabetes", "HIV", "Hospital & specialty", "Cardiovascular", "Neuroscience"}
    assert msd.brand.nunique() == 19
    assert df.t.max() == model.qindex(2025, 4)


def test_training_examples_never_see_past_the_origin(panel):
    _, units, _, price, inf = panel
    cutoff = model.qindex(2024, 2)
    ex = model.examples(units.iloc[:40], price.iloc[:40], inf, max_target_t=cutoff)
    assert len(ex) > 0
    assert (ex.t + ex.h <= cutoff).all()


def test_baselines_by_hand():
    units = pd.DataFrame([[100.0, 110.0, 120.0, 130.0, 140.0]], index=["X"], columns=[0, 1, 2, 3, 4])
    b = model.baselines(units, "X", 4, 1)
    assert b["naive"] == 140
    assert b["seasonal_naive"] == 110  # same quarter a year earlier: t + 1 - 4 = 1
    g = (math.log1p(140) - math.log1p(100)) / 4
    assert b["drift"] == pytest.approx(math.expm1(math.log1p(140) + g))


def test_drift_baseline_is_capped():
    units = pd.DataFrame([[1.0, 5.0, 20.0, 80.0, 1000.0]], index=["X"], columns=[0, 1, 2, 3, 4])
    b = model.baselines(units, "X", 4, 4)
    assert b["drift"] <= math.expm1(math.log1p(1000) + 0.22 * 4) + 1e-6


def test_wape():
    a = pd.Series([100.0, 100.0])
    assert model.wape(a, pd.Series([90.0, 110.0])) == pytest.approx(0.1)


def test_forecast_has_four_quarters_per_msd_brand_and_ordered_intervals():
    fc = pd.read_csv(model.MARTS / "forecast_2026.csv")
    assert fc.groupby("brand").size().eq(4).all()
    assert fc.brand.nunique() == 19
    assert (fc.spend_p10 <= fc.spend_p50 + 1e-6).all() and (fc.spend_p50 <= fc.spend_p90 + 1e-6).all()
    assert set(fc.quarter) == {"2026Q1", "2026Q2", "2026Q3", "2026Q4"}


def test_backtest_beats_baselines_overall_as_reported():
    s = pd.read_csv(model.MARTS / "backtest_summary.csv")
    allb = s[(s.scope == "All brands") & (s.horizon == "all")].iloc[0]
    assert allb.model < min(allb.naive, allb.seasonal_naive, allb.drift)


def test_a_scenario_with_no_change_is_the_forecast():
    r = scenario.run(scenario.Scenario(brand="januvia"))
    assert r.delta_total == pytest.approx(0, abs=1e-6)
    assert r.scenario.brand == "JANUVIA"


def test_price_change_is_all_price_effect():
    base = scenario.run(scenario.Scenario(brand="KEYTRUDA"))
    r = scenario.run(scenario.Scenario(brand="KEYTRUDA", price_change_pct=10))
    assert r.scenario_total == pytest.approx(base.base_total * 1.1, rel=1e-9)
    for q in r.quarters:
        assert q.volume_effect == pytest.approx(0, abs=1e-6)
        assert q.price_effect == pytest.approx(q.delta_spend, rel=1e-9)


def test_generic_entry_follows_the_measured_retention_curve():
    ret = scenario.retention()
    assert ret[0] < 1 and all(ret[k] >= ret[k + 1] for k in range(0, 8))
    r = scenario.run(scenario.Scenario(brand="JANUVIA", generic_entry_quarter="2026Q3"))
    q = {x.quarter: x for x in r.quarters}
    assert q["2026Q1"].delta_spend == pytest.approx(0, abs=1e-6)
    assert q["2026Q3"].spend == pytest.approx(q["2026Q3"].base_spend * ret[0], rel=1e-9)


@pytest.mark.parametrize(
    "kwargs",
    [dict(brand="JANUVIX"), dict(brand="JANUVIA", price_change_pct=-150), dict(brand="JANUVIA", generic_entry_quarter="2030Q1"), dict(brand="JANUVIA", start_quarter="2025Q4")],
)
def test_invalid_scenarios_are_refused(kwargs):
    with pytest.raises(ValidationError):
        scenario.Scenario(**kwargs)


def test_psi_is_zero_for_the_same_distribution_and_grows_with_a_shift():
    rng = np.random.default_rng(1)
    a = rng.normal(0, 1, 5000)
    assert health.psi(a, a) == pytest.approx(0, abs=1e-9)
    assert health.psi(a, a + 1) > 0.25


def test_health_has_no_failures():
    rows = health.checks()
    assert [r["id"] for r in rows if r["status"] == "fail"] == []
    assert len(rows) == 14
