/* JSDoc block grouping + ordering — second half of the
 * annotation-md cleanup.
 *
 * After jsdoc-wrap has turned `@tag` text into pill spans, this
 * pass:
 *   3. Wraps each `.wt-jsdoc-tag` + its following siblings into
 *      a `<span class="wt-jsdoc-block">` so pill and content
 *      render as one outlined card. Pulls `@example` code
 *      blocks, `@param` names, `{Type}` annotations into the
 *      right spots.
 *   4. Drops empty `@description` cards, lifts every block to
 *      container top level, synthesizes a `@description` card
 *      from leftover prose, and orders as:
 *        [@fileoverview?, @description?, others…]
 *
 * Exposes ns.groupJsdocBlocks(container). */
;(() => {
  const ns = window[Symbol.for('socket-pages')]
  if (!ns) {
    return
  }

  const firstMeaningfulChild = parent => {
    let node = parent.firstChild
    while (node) {
      if (node.nodeType === 3) {
        if ((node.nodeValue ?? '').trim() !== '') {
          return node
        }
        node = node.nextSibling
        continue
      }
      return node
    }
    return null
  }

  const absorbExampleBlock = (tagEl, block, body) => {
    /* For `@example` blocks: the fenced code block lives as a
     * sibling `<pre>` of the `<p>` that contains the `@example`
     * tag (marked emits `<p>@example</p><pre>…`). Body-scoop
     * reached only `<p>`-level siblings, so the `<pre>` is
     * orphaned below the description when we later reorder
     * blocks. Climb to the enclosing block-level ancestor of
     * `block` inside `.annotation-md` and absorb any
     * immediately-following `<pre>` siblings into the body.
     *
     * GOTCHA: depends on marked emitting `<p>@example</p>`
     * separate from its fenced `<pre>`. If meander swaps to a
     * markdown renderer that wraps the two together, this pass
     * fires zero times and `@example` cards render with empty
     * bodies. Symptom: `@EXAMPLE` pill sits alone, code block
     * hangs below the description. */
    if (tagEl.textContent?.toLowerCase() !== '@example') {
      return
    }
    const annotationRoot = block.closest('.annotation-md')
    let outer = block
    while (outer.parentElement && outer.parentElement !== annotationRoot) {
      outer = outer.parentElement
    }
    let sibling = outer.nextSibling
    while (sibling) {
      const next = sibling.nextSibling
      if (sibling.nodeType === 3) {
        const txt = sibling.nodeValue ?? ''
        if (txt.trim() === '') {
          sibling = next
          continue
        }
        break
      }
      if (sibling.nodeType === 1 && sibling.tagName === 'PRE') {
        body.appendChild(sibling)
        sibling = next
        continue
      }
      break
    }
  }

  const extractParamName = (tagEl, body) => {
    /* For `@param` blocks: pull the leading parameter name out
     * of the body's first text node. Source shape is `@param a -
     * First PackageURL…` which arrives in the body as text
     * starting with `a - First …`. Render the name as an inline
     * code pill next to the `@PARAM` tag on the top strip.
     * Separator is required so plain prose (`@param Builder
     * instance…`) doesn't mis-grab "Builder" as a name. */
    if (tagEl.dataset.tag !== 'param') {
      return
    }
    const firstTextNode =
      body.firstChild && body.firstChild.nodeType === 3 ? body.firstChild : null
    const nameMatch = firstTextNode
      ? (firstTextNode.nodeValue ?? '').match(
          /^\s*([A-Za-z_$][\w$]*)\s*[-—:]\s+/,
        )
      : null
    if (firstTextNode && nameMatch && nameMatch[1]) {
      const paramName = document.createElement('code')
      paramName.className = 'wt-purl wt-jsdoc-param-name'
      paramName.textContent = nameMatch[1]
      tagEl.insertAdjacentElement('afterend', paramName)
      firstTextNode.nodeValue = (firstTextNode.nodeValue ?? '').slice(
        nameMatch[0].length,
      )
      if (firstTextNode.nodeValue === '') {
        firstTextNode.remove()
      }
    }
  }

  const liftTypeAnnotation = (tagEl, body) => {
    /* For any tag carrying a `{Type}` (e.g. `@throws {Error}`,
     * `@returns {Promise<T>}`): the tag regex rendered the
     * brace-type as a `<code class="wt-purl">` that sits as an
     * early child of the body. Pull it up next to the tag on
     * the top strip so the header reads "[THROWS] `{Error}`" +
     * description below.
     *
     * Skip leading whitespace-only text nodes when looking for
     * the first element — the regex emits a space between the
     * tag span and the `{Type}` code, which lands as a text
     * node BEFORE the code inside the body. */
    const typeChild = firstMeaningfulChild(body)
    if (
      typeChild &&
      typeChild.nodeType === 1 &&
      typeChild.tagName === 'CODE' &&
      typeChild.classList.contains('wt-purl') &&
      /^\{[^}]*\}$/.test(typeChild.textContent ?? '')
    ) {
      /* Drop whitespace-only nodes before the type so they
       * don't end up at the head of the body after the pull. */
      while (body.firstChild && body.firstChild !== typeChild) {
        body.firstChild.remove()
      }
      typeChild.classList.add('wt-jsdoc-type')
      tagEl.insertAdjacentElement('afterend', typeChild)
      /* Strip leading whitespace / separator from the next text
       * node so the description starts clean. */
      const nextTextNode =
        body.firstChild && body.firstChild.nodeType === 3
          ? body.firstChild
          : null
      if (nextTextNode) {
        nextTextNode.nodeValue = (nextTextNode.nodeValue ?? '').replace(
          /^\s*(?:[-—:]\s*)?/,
          '',
        )
        if (nextTextNode.nodeValue === '') {
          nextTextNode.remove()
        }
      }
    }
  }

  const buildBlocks = container => {
    /* Group each `.wt-jsdoc-tag` + its following siblings (up
     * to the next `.wt-jsdoc-tag` or end-of-parent) into a
     * `<span class="wt-jsdoc-block">`. Walk forward: each
     * iteration wraps one tag's range and jumps the cursor past
     * the new block to pick up the next tag at the same sibling
     * level. Reverse-walking nested the cards inside each other. */
    const tags = Array.from(container.querySelectorAll('.wt-jsdoc-tag'))
    for (const tagEl of tags) {
      const parent = tagEl.parentElement
      if (!parent || parent.classList.contains('wt-jsdoc-block')) {
        continue
      }
      const block = document.createElement('span')
      block.className = 'wt-jsdoc-block'
      parent.insertBefore(block, tagEl)
      block.appendChild(tagEl)
      const body = document.createElement('span')
      body.className = 'wt-jsdoc-body'
      block.appendChild(body)
      let cur = block.nextSibling
      while (cur) {
        const next = cur.nextSibling
        if (cur.nodeType === 1 && cur.classList?.contains('wt-jsdoc-tag')) {
          break
        }
        /* Trim a stray <br> at the head of body — the pill's
         * CSS margin handles separation; we don't need an extra
         * blank line at the top of the body area. */
        if (
          body.childNodes.length === 0 &&
          cur.nodeType === 1 &&
          cur.nodeName === 'BR'
        ) {
          cur.remove()
          cur = next
          continue
        }
        body.appendChild(cur)
        cur = next
      }
      absorbExampleBlock(tagEl, block, body)
      extractParamName(tagEl, body)
      liftTypeAnnotation(tagEl, body)
    }
  }

  const orderBlocks = container => {
    /* [explicit @description?, synthetic @description from
     * leftover prose?, other tag cards in source order].
     * JSDoc source is usually "description, then @param /
     * @returns / @throws"; the tour inverts this so the
     * description leads the stack and the tagged contract
     * supports it. */
    const allBlocks = Array.from(container.querySelectorAll('.wt-jsdoc-block'))
    /* Drop explicit @description blocks whose body is empty
     * (source was `@description` alone with no following prose,
     * or the prose ran directly into the next tag). Empty cards
     * are visual noise — the pill has nothing under it. */
    const emptyDescs = allBlocks.filter(b => {
      const isDesc = b.querySelector(
        ':scope > .wt-jsdoc-tag[data-tag="description"]',
      )
      if (!isDesc) {
        return false
      }
      const body = b.querySelector(':scope > .wt-jsdoc-body')
      return !body || (body.textContent ?? '').trim() === ''
    })
    for (const b of emptyDescs) {
      b.remove()
    }
    const liveBlocks = allBlocks.filter(b => !emptyDescs.includes(b))
    const explicitDesc = liveBlocks.find(b =>
      b.querySelector(':scope > .wt-jsdoc-tag[data-tag="description"]'),
    )
    const otherBlocks = liveBlocks.filter(b => b !== explicitDesc)
    if (explicitDesc) {
      explicitDesc.classList.add('wt-jsdoc-block-desc')
    }
    /* Lift every tag block out of its markdown-wrapper parent
     * (marked emits `<p>@tag …</p>`, so step 3 wraps the block
     * inside the `<p>`). Move each block to the container's top
     * level first, so the synthesis below only sees true
     * leftover prose (the `<p>` text between tag blocks or at
     * the end of the source). Without this lift,
     * container.childNodes still holds the original `<p>`
     * wrappers and the synthesis loop mistakes them for prose. */
    for (const b of liveBlocks) {
      if (b.parentElement !== container) {
        container.appendChild(b)
      }
    }
    /* Synthesize a @DESCRIPTION card from leftover prose when
     * no explicit one exists. Leftover prose = everything in
     * the container that isn't a .wt-jsdoc-block. */
    let syntheticDesc = null
    if (!explicitDesc) {
      const descBlock = document.createElement('span')
      descBlock.className = 'wt-jsdoc-block wt-jsdoc-block-desc'
      const descTag = document.createElement('span')
      descTag.className = 'wt-jsdoc-tag'
      descTag.textContent = '@description'
      descTag.dataset.tag = 'description'
      descBlock.appendChild(descTag)
      const descBody = document.createElement('span')
      descBody.className = 'wt-jsdoc-body'
      descBlock.appendChild(descBody)
      for (const node of Array.from(container.childNodes)) {
        if (node.nodeType === 1 && node.classList.contains('wt-jsdoc-block')) {
          continue
        }
        descBody.appendChild(node)
      }
      if ((descBody.textContent ?? '').trim() !== '') {
        syntheticDesc = descBlock
      }
    }
    /* `@fileoverview` is file-level metadata ("what is this
     * file for"); it reads more naturally BEFORE the
     * function-level description. Lift it to lead position
     * when present, then the description stack, then the other
     * tag cards in source order. */
    const fileoverview = otherBlocks.find(b =>
      b.querySelector(':scope > .wt-jsdoc-tag[data-tag="fileoverview"]'),
    )
    const otherBlocksMinusOverview = otherBlocks.filter(b => b !== fileoverview)
    const ordered = [
      ...(fileoverview ? [fileoverview] : []),
      ...(explicitDesc ? [explicitDesc] : []),
      ...(syntheticDesc ? [syntheticDesc] : []),
      ...otherBlocksMinusOverview,
    ]
    for (let i = ordered.length - 1; i >= 0; i -= 1) {
      container.insertBefore(ordered[i], container.firstChild)
    }
  }

  ns.groupJsdocBlocks = container => {
    buildBlocks(container)
    orderBlocks(container)
  }
})()
