/**
 * The background sequence's real frames.
 *
 * public/bg held 1,076 files, but only these 301 are distinct pictures --
 * every one was repeated three or four times in a row, an artefact of
 * stretching a 301-frame render onto a longer timeline. That shipped 98 MB
 * to deliver 27 MB, over 1,076 requests, and held 1,076 decoded 1080p
 * bitmaps in memory.
 *
 * The names are not sequential because the surviving files keep the names
 * they always had; the 775 removed ones were byte-for-byte identical to a
 * file in this list, so the animation is unchanged frame for frame.
 *
 * GENERATED. Regenerate by hashing public/bg and keeping the first file of
 * each run of identical frames.
 */
export const BG_FRAMES: readonly string[] = [
  "frame_0001.webp", "frame_0005.webp", "frame_0008.webp", "frame_0012.webp", "frame_0015.webp", "frame_0019.webp",
  "frame_0022.webp", "frame_0026.webp", "frame_0030.webp", "frame_0033.webp", "frame_0037.webp", "frame_0040.webp",
  "frame_0044.webp", "frame_0047.webp", "frame_0051.webp", "frame_0055.webp", "frame_0058.webp", "frame_0062.webp",
  "frame_0065.webp", "frame_0069.webp", "frame_0072.webp", "frame_0076.webp", "frame_0080.webp", "frame_0083.webp",
  "frame_0087.webp", "frame_0090.webp", "frame_0094.webp", "frame_0098.webp", "frame_0101.webp", "frame_0105.webp",
  "frame_0108.webp", "frame_0112.webp", "frame_0115.webp", "frame_0119.webp", "frame_0123.webp", "frame_0126.webp",
  "frame_0130.webp", "frame_0133.webp", "frame_0137.webp", "frame_0140.webp", "frame_0144.webp", "frame_0148.webp",
  "frame_0151.webp", "frame_0155.webp", "frame_0158.webp", "frame_0162.webp", "frame_0165.webp", "frame_0169.webp",
  "frame_0173.webp", "frame_0176.webp", "frame_0180.webp", "frame_0183.webp", "frame_0187.webp", "frame_0190.webp",
  "frame_0194.webp", "frame_0198.webp", "frame_0201.webp", "frame_0205.webp", "frame_0208.webp", "frame_0212.webp",
  "frame_0215.webp", "frame_0219.webp", "frame_0223.webp", "frame_0226.webp", "frame_0230.webp", "frame_0233.webp",
  "frame_0237.webp", "frame_0241.webp", "frame_0244.webp", "frame_0248.webp", "frame_0251.webp", "frame_0255.webp",
  "frame_0258.webp", "frame_0262.webp", "frame_0266.webp", "frame_0269.webp", "frame_0273.webp", "frame_0276.webp",
  "frame_0280.webp", "frame_0283.webp", "frame_0287.webp", "frame_0291.webp", "frame_0294.webp", "frame_0298.webp",
  "frame_0301.webp", "frame_0305.webp", "frame_0308.webp", "frame_0312.webp", "frame_0316.webp", "frame_0319.webp",
  "frame_0323.webp", "frame_0326.webp", "frame_0330.webp", "frame_0333.webp", "frame_0337.webp", "frame_0341.webp",
  "frame_0344.webp", "frame_0348.webp", "frame_0351.webp", "frame_0355.webp", "frame_0358.webp", "frame_0362.webp",
  "frame_0366.webp", "frame_0369.webp", "frame_0373.webp", "frame_0376.webp", "frame_0380.webp", "frame_0384.webp",
  "frame_0387.webp", "frame_0391.webp", "frame_0394.webp", "frame_0398.webp", "frame_0401.webp", "frame_0405.webp",
  "frame_0409.webp", "frame_0412.webp", "frame_0416.webp", "frame_0419.webp", "frame_0423.webp", "frame_0426.webp",
  "frame_0430.webp", "frame_0434.webp", "frame_0437.webp", "frame_0441.webp", "frame_0444.webp", "frame_0448.webp",
  "frame_0451.webp", "frame_0455.webp", "frame_0459.webp", "frame_0462.webp", "frame_0466.webp", "frame_0469.webp",
  "frame_0473.webp", "frame_0476.webp", "frame_0480.webp", "frame_0484.webp", "frame_0487.webp", "frame_0491.webp",
  "frame_0494.webp", "frame_0498.webp", "frame_0501.webp", "frame_0505.webp", "frame_0509.webp", "frame_0512.webp",
  "frame_0516.webp", "frame_0519.webp", "frame_0523.webp", "frame_0527.webp", "frame_0530.webp", "frame_0534.webp",
  "frame_0537.webp", "frame_0541.webp", "frame_0544.webp", "frame_0548.webp", "frame_0552.webp", "frame_0555.webp",
  "frame_0559.webp", "frame_0562.webp", "frame_0566.webp", "frame_0569.webp", "frame_0573.webp", "frame_0577.webp",
  "frame_0580.webp", "frame_0584.webp", "frame_0587.webp", "frame_0591.webp", "frame_0594.webp", "frame_0598.webp",
  "frame_0602.webp", "frame_0605.webp", "frame_0609.webp", "frame_0612.webp", "frame_0616.webp", "frame_0619.webp",
  "frame_0623.webp", "frame_0627.webp", "frame_0630.webp", "frame_0634.webp", "frame_0637.webp", "frame_0641.webp",
  "frame_0644.webp", "frame_0648.webp", "frame_0652.webp", "frame_0655.webp", "frame_0659.webp", "frame_0662.webp",
  "frame_0666.webp", "frame_0670.webp", "frame_0673.webp", "frame_0677.webp", "frame_0680.webp", "frame_0684.webp",
  "frame_0687.webp", "frame_0691.webp", "frame_0695.webp", "frame_0698.webp", "frame_0702.webp", "frame_0705.webp",
  "frame_0709.webp", "frame_0712.webp", "frame_0716.webp", "frame_0720.webp", "frame_0723.webp", "frame_0727.webp",
  "frame_0730.webp", "frame_0734.webp", "frame_0737.webp", "frame_0741.webp", "frame_0745.webp", "frame_0748.webp",
  "frame_0752.webp", "frame_0755.webp", "frame_0759.webp", "frame_0762.webp", "frame_0766.webp", "frame_0770.webp",
  "frame_0773.webp", "frame_0777.webp", "frame_0780.webp", "frame_0784.webp", "frame_0787.webp", "frame_0791.webp",
  "frame_0795.webp", "frame_0798.webp", "frame_0802.webp", "frame_0805.webp", "frame_0809.webp", "frame_0812.webp",
  "frame_0816.webp", "frame_0820.webp", "frame_0823.webp", "frame_0827.webp", "frame_0830.webp", "frame_0834.webp",
  "frame_0838.webp", "frame_0841.webp", "frame_0845.webp", "frame_0848.webp", "frame_0852.webp", "frame_0855.webp",
  "frame_0859.webp", "frame_0863.webp", "frame_0866.webp", "frame_0870.webp", "frame_0873.webp", "frame_0877.webp",
  "frame_0880.webp", "frame_0884.webp", "frame_0888.webp", "frame_0891.webp", "frame_0895.webp", "frame_0898.webp",
  "frame_0902.webp", "frame_0905.webp", "frame_0909.webp", "frame_0913.webp", "frame_0916.webp", "frame_0920.webp",
  "frame_0923.webp", "frame_0927.webp", "frame_0930.webp", "frame_0934.webp", "frame_0938.webp", "frame_0941.webp",
  "frame_0945.webp", "frame_0948.webp", "frame_0952.webp", "frame_0955.webp", "frame_0959.webp", "frame_0963.webp",
  "frame_0966.webp", "frame_0970.webp", "frame_0973.webp", "frame_0977.webp", "frame_0981.webp", "frame_0984.webp",
  "frame_0988.webp", "frame_0991.webp", "frame_0995.webp", "frame_0998.webp", "frame_1002.webp", "frame_1006.webp",
  "frame_1009.webp", "frame_1013.webp", "frame_1016.webp", "frame_1020.webp", "frame_1023.webp", "frame_1027.webp",
  "frame_1031.webp", "frame_1034.webp", "frame_1038.webp", "frame_1041.webp", "frame_1045.webp", "frame_1048.webp",
  "frame_1052.webp", "frame_1056.webp", "frame_1059.webp", "frame_1063.webp", "frame_1066.webp", "frame_1070.webp",
  "frame_1073.webp",
];
