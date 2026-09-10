/**
 * The background sequence's frames.
 *
 * Re-extracted from background_no_watermark.mp4 and encoded as AVIF.
 *
 * Two things changed at once, and the first matters more. The WebP frames
 * this replaces were taken from a source that carried a generator's
 * watermark -- a four-pointed star in the lower right, visible in every
 * frame the console rendered. The clean source has none.
 *
 * AVIF because it is smaller at higher fidelity, and because it decodes no
 * slower: measured in Chrome at 35.8 ms for a 1920x1080 frame against WebP's
 * 37.2 ms, which matters here because the animation holds pre-decoded
 * bitmaps rather than seeking a video.
 *
 * Encoded one frame per ffmpeg invocation through the avif muxer. Batching
 * with -f image2 is far quicker and produces files that ffmpeg reads back
 * happily and Chrome refuses outright, which is a trap worth naming: the
 * encoder is not the thing that has to decode these.
 *
 *   301 frames, 17 MB, ~54 KB each, SSIM 0.977-0.989 against the source
 *   was: 301 WebP, 27.4 MB, watermarked
 *
 * GENERATED from the contents of public/bg.
 */
export const BG_FRAMES: readonly string[] = [
  "frame_0001.avif", "frame_0002.avif", "frame_0003.avif", "frame_0004.avif", "frame_0005.avif", "frame_0006.avif",
  "frame_0007.avif", "frame_0008.avif", "frame_0009.avif", "frame_0010.avif", "frame_0011.avif", "frame_0012.avif",
  "frame_0013.avif", "frame_0014.avif", "frame_0015.avif", "frame_0016.avif", "frame_0017.avif", "frame_0018.avif",
  "frame_0019.avif", "frame_0020.avif", "frame_0021.avif", "frame_0022.avif", "frame_0023.avif", "frame_0024.avif",
  "frame_0025.avif", "frame_0026.avif", "frame_0027.avif", "frame_0028.avif", "frame_0029.avif", "frame_0030.avif",
  "frame_0031.avif", "frame_0032.avif", "frame_0033.avif", "frame_0034.avif", "frame_0035.avif", "frame_0036.avif",
  "frame_0037.avif", "frame_0038.avif", "frame_0039.avif", "frame_0040.avif", "frame_0041.avif", "frame_0042.avif",
  "frame_0043.avif", "frame_0044.avif", "frame_0045.avif", "frame_0046.avif", "frame_0047.avif", "frame_0048.avif",
  "frame_0049.avif", "frame_0050.avif", "frame_0051.avif", "frame_0052.avif", "frame_0053.avif", "frame_0054.avif",
  "frame_0055.avif", "frame_0056.avif", "frame_0057.avif", "frame_0058.avif", "frame_0059.avif", "frame_0060.avif",
  "frame_0061.avif", "frame_0062.avif", "frame_0063.avif", "frame_0064.avif", "frame_0065.avif", "frame_0066.avif",
  "frame_0067.avif", "frame_0068.avif", "frame_0069.avif", "frame_0070.avif", "frame_0071.avif", "frame_0072.avif",
  "frame_0073.avif", "frame_0074.avif", "frame_0075.avif", "frame_0076.avif", "frame_0077.avif", "frame_0078.avif",
  "frame_0079.avif", "frame_0080.avif", "frame_0081.avif", "frame_0082.avif", "frame_0083.avif", "frame_0084.avif",
  "frame_0085.avif", "frame_0086.avif", "frame_0087.avif", "frame_0088.avif", "frame_0089.avif", "frame_0090.avif",
  "frame_0091.avif", "frame_0092.avif", "frame_0093.avif", "frame_0094.avif", "frame_0095.avif", "frame_0096.avif",
  "frame_0097.avif", "frame_0098.avif", "frame_0099.avif", "frame_0100.avif", "frame_0101.avif", "frame_0102.avif",
  "frame_0103.avif", "frame_0104.avif", "frame_0105.avif", "frame_0106.avif", "frame_0107.avif", "frame_0108.avif",
  "frame_0109.avif", "frame_0110.avif", "frame_0111.avif", "frame_0112.avif", "frame_0113.avif", "frame_0114.avif",
  "frame_0115.avif", "frame_0116.avif", "frame_0117.avif", "frame_0118.avif", "frame_0119.avif", "frame_0120.avif",
  "frame_0121.avif", "frame_0122.avif", "frame_0123.avif", "frame_0124.avif", "frame_0125.avif", "frame_0126.avif",
  "frame_0127.avif", "frame_0128.avif", "frame_0129.avif", "frame_0130.avif", "frame_0131.avif", "frame_0132.avif",
  "frame_0133.avif", "frame_0134.avif", "frame_0135.avif", "frame_0136.avif", "frame_0137.avif", "frame_0138.avif",
  "frame_0139.avif", "frame_0140.avif", "frame_0141.avif", "frame_0142.avif", "frame_0143.avif", "frame_0144.avif",
  "frame_0145.avif", "frame_0146.avif", "frame_0147.avif", "frame_0148.avif", "frame_0149.avif", "frame_0150.avif",
  "frame_0151.avif", "frame_0152.avif", "frame_0153.avif", "frame_0154.avif", "frame_0155.avif", "frame_0156.avif",
  "frame_0157.avif", "frame_0158.avif", "frame_0159.avif", "frame_0160.avif", "frame_0161.avif", "frame_0162.avif",
  "frame_0163.avif", "frame_0164.avif", "frame_0165.avif", "frame_0166.avif", "frame_0167.avif", "frame_0168.avif",
  "frame_0169.avif", "frame_0170.avif", "frame_0171.avif", "frame_0172.avif", "frame_0173.avif", "frame_0174.avif",
  "frame_0175.avif", "frame_0176.avif", "frame_0177.avif", "frame_0178.avif", "frame_0179.avif", "frame_0180.avif",
  "frame_0181.avif", "frame_0182.avif", "frame_0183.avif", "frame_0184.avif", "frame_0185.avif", "frame_0186.avif",
  "frame_0187.avif", "frame_0188.avif", "frame_0189.avif", "frame_0190.avif", "frame_0191.avif", "frame_0192.avif",
  "frame_0193.avif", "frame_0194.avif", "frame_0195.avif", "frame_0196.avif", "frame_0197.avif", "frame_0198.avif",
  "frame_0199.avif", "frame_0200.avif", "frame_0201.avif", "frame_0202.avif", "frame_0203.avif", "frame_0204.avif",
  "frame_0205.avif", "frame_0206.avif", "frame_0207.avif", "frame_0208.avif", "frame_0209.avif", "frame_0210.avif",
  "frame_0211.avif", "frame_0212.avif", "frame_0213.avif", "frame_0214.avif", "frame_0215.avif", "frame_0216.avif",
  "frame_0217.avif", "frame_0218.avif", "frame_0219.avif", "frame_0220.avif", "frame_0221.avif", "frame_0222.avif",
  "frame_0223.avif", "frame_0224.avif", "frame_0225.avif", "frame_0226.avif", "frame_0227.avif", "frame_0228.avif",
  "frame_0229.avif", "frame_0230.avif", "frame_0231.avif", "frame_0232.avif", "frame_0233.avif", "frame_0234.avif",
  "frame_0235.avif", "frame_0236.avif", "frame_0237.avif", "frame_0238.avif", "frame_0239.avif", "frame_0240.avif",
  "frame_0241.avif", "frame_0242.avif", "frame_0243.avif", "frame_0244.avif", "frame_0245.avif", "frame_0246.avif",
  "frame_0247.avif", "frame_0248.avif", "frame_0249.avif", "frame_0250.avif", "frame_0251.avif", "frame_0252.avif",
  "frame_0253.avif", "frame_0254.avif", "frame_0255.avif", "frame_0256.avif", "frame_0257.avif", "frame_0258.avif",
  "frame_0259.avif", "frame_0260.avif", "frame_0261.avif", "frame_0262.avif", "frame_0263.avif", "frame_0264.avif",
  "frame_0265.avif", "frame_0266.avif", "frame_0267.avif", "frame_0268.avif", "frame_0269.avif", "frame_0270.avif",
  "frame_0271.avif", "frame_0272.avif", "frame_0273.avif", "frame_0274.avif", "frame_0275.avif", "frame_0276.avif",
  "frame_0277.avif", "frame_0278.avif", "frame_0279.avif", "frame_0280.avif", "frame_0281.avif", "frame_0282.avif",
  "frame_0283.avif", "frame_0284.avif", "frame_0285.avif", "frame_0286.avif", "frame_0287.avif", "frame_0288.avif",
  "frame_0289.avif", "frame_0290.avif", "frame_0291.avif", "frame_0292.avif", "frame_0293.avif", "frame_0294.avif",
  "frame_0295.avif", "frame_0296.avif", "frame_0297.avif", "frame_0298.avif", "frame_0299.avif", "frame_0300.avif",
  "frame_0301.avif",
];
