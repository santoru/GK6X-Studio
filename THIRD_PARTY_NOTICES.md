# Third-party notices

## pixeltris/GK6X

`js/protocol.js`, `js/keycodes.js` and `js/lighting.js` port protocol logic from
https://github.com/pixeltris/GK6X (commit 1348eafaac4b2e86855427618f2e806d0c4e3cf4), under this license:

```
MIT License

Copyright (c) 2021 pixeltris

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Device data

`js/models.js` (key matrix codes, LED location codes and key positions) is generated from the device files in
pixeltris/GK6X `Build/Data/`. Upstream states that those files are not covered by its license, as they are
proprietary to the keyboard software vendor (jikedingzhi). No vendor lighting effects are included: the effects
in `js/effects.js` are original and generated from key geometry.
