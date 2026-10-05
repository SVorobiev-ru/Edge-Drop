import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import { buildFileDragSvg, getFileKindSvgContent } from '../electron/main/fileSvg'
import type { FileKind } from '../shared/fileKind'

const KINDS: FileKind[] = [
  'pdf', 'word', 'excel', 'powerpoint', 'archive', 'text', 'code',
  'audio', 'video', 'image', 'executable', 'folder', 'file'
]

const sha = (s: string): string => createHash('sha256').update(s).digest('hex')

const EXPECTED: Record<string, string> = {
  'pdf|drag': '6b1d80ff78cbc697e83e1d796317a4c5f573fce4d40d622123f55664eaa93dd7',
  'pdf|stack-1': '6596c0eba64498c4e3789c85fc141c215a5c33f906e977eeb0f01904222d304f',
  'pdf|single-svg': '71d76d2e82300ab4e7bd2b8bfcb682b47bb368425e9d3bfd37adacc2cacb2c67',
  'word|drag': '7b77b85d74f04c7009532db4caf4f441b71775309130a97fdcb94bc10cdd25cf',
  'word|stack-1': '87e6d4ac7a34e1c14189be9032fdc2e411c1c99844f229469abdcbb6144b3ea8',
  'word|single-svg': 'edfa90299ad41b6565ed0095aa428b5596722bc204901c1ca7c0fd0dfb9119ba',
  'excel|drag': 'cd7bbda4ac984bb28f9f29102b0ac60f272af964312937e34628c3be56ef4ed0',
  'excel|stack-1': '9932dbe5a2411d85f5b317c250c898ebd1c591da4221f0ea29c9fa62c139760d',
  'excel|single-svg': 'ebc9bf3c0d5f38afffb85f45453b0fdcc6be2dd56198c8c1271d09554f91b20f',
  'powerpoint|drag': '03206bd9e08a862b7d7369ab274b72f8535ca01d10435742085119f5099d03cb',
  'powerpoint|stack-1': '9a8d85c7ced7bc493d4a72e9c814d48353f8745b34f56bc7a00e22b94d7ddc81',
  'powerpoint|single-svg': '0592285b235bb49076539ba1c2d5e1e3ae136891443c284f6cc40ce5740f061b',
  'archive|drag': 'cda2b28e15e80bb5c178b015429f2e72bc765f0c6e7c8ce40eb11ee3b0f204e1',
  'archive|stack-1': '46bf3971928c15ebca25700c5e1f254fcf4d2bf7ff36e808d0f54bebd49a10be',
  'archive|single-svg': 'e4b7313bdac4f0797c48865b30e6fca51ae7b1be21f88f438931990e3f379558',
  'text|drag': '5ab9c6e830d3b7a2b10cd523a9caa8b23c4c864e291f06488c2a6f170327c9e9',
  'text|stack-1': '2ccfd61891bc2a9c200ecbf7659274669449c2b45854c29758f1b382e3f7b3e0',
  'text|single-svg': 'f38fb9cc1bb702bf8ffb802ac51a01af4b24c6c2fac31399c4e775b6d4594f80',
  'code|drag': '5b1e571e0963653dc3fad74e57313cddd5e5145f5ec4d2556111206beaef3130',
  'code|stack-1': 'cc8497dfe6424ca7a5af2c98e252fbc02c090dbe7d4bc67343637ac5d50d3d45',
  'code|single-svg': '4213386d800920721c49d72e1f0a18be6572fdd74a14ae67085b8754cddc5f4c',
  'audio|drag': 'e7e961f3f27d21320399d10aa976d64d8486772fc07ddb99d2c720125467248b',
  'audio|stack-1': 'b5dc07b09757708b6b6a91468344f5270636597e0e5cd79292217eb690d71008',
  'audio|single-svg': 'faa4841b90e18aa559daa2cf96bf52f7d6b7ee60f82e3aa9c6b7468a852b0f83',
  'video|drag': 'b67f9fbddd12c1381bb5ac863a3a19e9d50a73bd4100790006300e4fd46cdb70',
  'video|stack-1': 'db8bb6ebd6aae72673039f367345e7162fba05cd9dbbed0324f708adfdba3f15',
  'video|single-svg': '6f27e6dcb1edac6105ced88e2d5cae15b9a226d9d9d49ee6f3864d1bef564e6d',
  'image|drag': '89b3a59d20e289ac54e604d6a31d88b539288467326d252ade80608e43db95a6',
  'image|stack-1': '107759274b2334f6237711665338c63dc4000f11982113f73e293710f142c26e',
  'image|single-svg': '697066768c5a2bc85597227b42efd50d1ffeb5752f9140aed61bc0ec69929379',
  'executable|drag': '7b05f85ee7e4c60b4b09b590fe269c5f4e693b7bc0b7fe8557d2e9ba88f58eec',
  'executable|stack-1': '407e9adf90c90a13f60b57a096b907fbafc0d4fd41f5a86b5396008e1614d685',
  'executable|single-svg': '43a3dcb580d68dc8e14628ec37a380dc64cad1d43e2a95a39edaac237778db40',
  'folder|drag': '91e220cf5b6382eb57610a0ba27508f218bfcc377c62c6919ea3360f143cd838',
  'folder|stack-1': '361a933611c10d53603ea6a0f60a0c84175cd473d9e117fad4db9fd34bcde126',
  'folder|single-svg': 'e49f0c8ce10de3b69808bade815af861e0ed0b043f3e183ef4b04fbc96b2637e',
  'file|drag': '6db809e6a5189f0b31b6d7c5a948cb71496833d936a302a9c246c0a5593cf01c',
  'file|stack-1': '4a1c85c2201948de64db74161b4eda274594ae010e45407ccd0974b3047cfada',
  'file|single-svg': '16f2a803e33576a2bc3566acfea3eaafdb79522b10df3fc3715ffe8d11e77f6a',
  'unknown|drag': '6db809e6a5189f0b31b6d7c5a948cb71496833d936a302a9c246c0a5593cf01c',
  'stack2': '0352d0618b264eaf119d0f2460958003d5087c4a9f6f230593c830339e681a86',
  'stack3': 'e6c8f4e677a55f25a692f31767c06a420efcf24176e8a87c5b728fd185bb1216',
  'stack5': 'c93da02b5c76e10d5800c48a968daeaba11f5f03e7bc75661030f871b7c6ff82',
  'empty': '16f2a803e33576a2bc3566acfea3eaafdb79522b10df3fc3715ffe8d11e77f6a'
}

describe('fileSvg output stays byte-identical', () => {
  it('matches the hashes captured before the folder-body helper was extracted', () => {
    const out: Record<string, string> = {}
    for (const kind of KINDS) {
      out[`${kind}|drag`] = sha(getFileKindSvgContent(kind))
      out[`${kind}|stack-1`] = sha(getFileKindSvgContent(kind, 'stack-1'))
      out[`${kind}|single-svg`] = sha(buildFileDragSvg([kind], 1))
    }
    out['unknown|drag'] = sha(getFileKindSvgContent('nope' as FileKind))
    out['stack2'] = sha(buildFileDragSvg(['image', 'image'], 2))
    out['stack3'] = sha(buildFileDragSvg(['pdf', 'excel', 'folder'], 3))
    out['stack5'] = sha(buildFileDragSvg(['archive', 'video', 'audio', 'code'], 5))
    out['empty'] = sha(buildFileDragSvg([], 0))
    expect(out).toEqual(EXPECTED)
  })
})
