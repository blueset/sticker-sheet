// Benchmark device/network profiles shared by the benchmark harness.
//
// `network` values mirror Chrome DevTools' "Fast 4G" throttling preset
// (as emulated via CDP `Network.emulateNetworkConditions`): a nominal
// 9 Mbps down / 1.5 Mbps up / 60 ms RTT, each scaled by the preset's
// correction factors (0.9x throughput, 2.75x latency).
export interface NetworkConditions {
  offline: boolean;
  latency: number; // ms
  downloadThroughput: number; // bytes/sec
  uploadThroughput: number; // bytes/sec
}

export interface Profile {
  device?: string;
  cpuSlowdown: number;
  network: NetworkConditions | null;
}

export const PROFILES: { mobile: Profile; desktop: Profile } = {
  mobile: {
    device: "Pixel 7",
    cpuSlowdown: 4,
    network: {
      offline: false,
      latency: 165,
      downloadThroughput: 1_012_500,
      uploadThroughput: 168_750,
    },
  },
  desktop: {
    cpuSlowdown: 1,
    network: null,
  },
};
