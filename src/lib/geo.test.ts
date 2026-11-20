import { describe, expect, it } from 'vitest';
import { applyTravelRules, travelRulesFromCompany } from '@/lib/geo';

describe('travelRulesFromCompany', () => {
  it('reads HQ and rules from a company row', () => {
    expect(travelRulesFromCompany({ hq_lat: '52.1', hq_lng: '11.7', remote_threshold_km: '80', remote_bonus_minutes: 30 }))
      .toEqual({ hq: { lat: 52.1, lng: 11.7 }, remoteThresholdKm: 80, remoteBonusMinutes: 30 });
  });

  it('has no HQ when coordinates are missing', () => {
    expect(travelRulesFromCompany({ hq_lat: null, hq_lng: 11.7 }).hq).toBeNull();
    expect(travelRulesFromCompany(undefined)).toEqual({ hq: null, remoteThresholdKm: 95, remoteBonusMinutes: 60 });
  });
});

describe('applyTravelRules', () => {
  const rules = { hq: { lat: 0, lng: 0 }, remoteThresholdKm: 95, remoteBonusMinutes: 60 };

  it('adds the bonus only beyond the threshold', () => {
    expect(applyTravelRules({ km: 95, minutes: 70 }, rules)).toEqual({ distanceKm: 95, travelMinutes: 70, isRemote: false });
    expect(applyTravelRules({ km: 95.1, minutes: 70 }, rules)).toEqual({ distanceKm: 95.1, travelMinutes: 130, isRemote: true });
  });

  it('treats a threshold of 0 as "no remote sites"', () => {
    expect(applyTravelRules({ km: 500, minutes: 300 }, { ...rules, remoteThresholdKm: 0 }).isRemote).toBe(false);
  });
});
