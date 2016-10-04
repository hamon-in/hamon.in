---

title: "Text processing in UNIX"

date: "2013-09-03 16:12:52 +0530"

---


### Introduction



I've been conducting a series of workshops at engineering colleges in Kerala. It's a 2 day presentation titled "Programming as Engineering" and designed to inspire rather than instruct. It is structured as 5 separate "topics" viz. UNIX, Optimisation, Higher order functions, Data structures and small languages. They're distinct from each other so that I have the flexibility to cut it into a shorter one day course if necessary. I've conducted it five times now and it's been fairly well received.


I took a tiny piece of the UNIX presentation and delivered it as a lightning talk at [PyCon India 2013](http://in.pycon.org/2013/). I then expanded it a little and did an open space on Shell + Emacs tricks at the same conference which also seemed to interest a few folks. One of the things we touched was to take the text of a book and to try to extract as much information about the book as possible without reading it. In this blog post, I'm going to detail the exercise. The UNIX shell is as underrated as it is powerful and I think it's a worthwhile exercise to remind ourselves of that.


To run this, I took a copy of [Moby Dick from the Gutenberg project website](http://www.gutenberg.org/cache/epub/2701/pg2701.txt). I excised the headers and footers added by the project and scrubbed the file to use UNIX newlines. The exercise is to get as much information from the book as possible without actually reading it. I was inspired to do this from [Sherlock Holmes' trick in the beginning of the Valley of Fear](http://www.archive.org/stream/valleyfearasher00doylgoog#page/n16/mode/2up) where the detective deduces the name of a book from some information that one of his agents send him.


### The analysis


I use zsh version 4.3.17 on Debian. These examples are tested with that shell but they should work with bash too since I don't use too many esoteric features.


First, we try to find the number of chapters in the book. This is not too hard. We simply run this.

{% highlight bash %}

grep -iw chapter moby-dick.txt | wc -l

{% endhighlight %}

and we get `172`. So we know that it has (roughly) 172 chapters. The `-i` option to grep makes the search case insensitive (we match `Chapter` and `chapter`). The `-w` restricts the pattern to word boundaries. So, we won't match things like `chapters`.


Next, we try to get the number of pages in the book. A typical paperback book, which is the kind I'd get if I bought a paper copy of Moby Dick, has approximately 350 words on a page (35 lines per page and 10 words per line). I know this because I actually counted them on 10 books. We can get this using

{% highlight bash %}

expr $(wc -w moby-dick.txt | awk '{print $1}') / 350

{% endhighlight %}

[expr](http://unixhelp.ed.ac.uk/CGI/man-cgi?expr) is an under appreciated command line calculator that you can use in a pipeline. The `$(` and `)` is command substitution where the snippet inside the brackets is run and the output put instead of the `$(` and `)`. In this case, we simply count the words and get the count. We get this and divide it by 350. The output is `595`. That's around 3 pages a chapter on the average.


The next thing we try to get is the length of sentences. This is useful to approximate the reading grade for the book. The [Flesch-Kincaid](https://en.wikipedia.org/wiki/Flesch%E2%80%93Kincaid_readability_test) tests use these (among other things) to calculate the reading level for the book. It's also fair to say that technical books usually keep the sentence lengths somewhat low (although code snippets can ruin our estimations). Childrens books have shorter sentences. The sentences we usually speak during conversation are about 20 words long. To do this, first we run the book through `tr '\n' ' '`. This changes all newlines to spaces so the whole book fits on a single line. Then we pipe that through `tr '.' '\n'` which converts it to a single sentence per line. We then count the words per such "line" using `awk '{print NF}'` and then we pipe that through `sort -n | uniq -c | sort -n` which gives us a frequency count per sentence length in increasing order. The last few lines will tell us what the lengths of most of the sentences are.


{% highlight bash %}

cat moby-dick.txt | tr '\n' '  ' | tr '.' '\n'  | awk '{print NF}'  | sort -n | uniq -c | sort -n

{% endhighlight %}


The last 20 lines of this gives me


        153 27

        158 24

        158 25

        159 12

        162 13

        163 26

        164 20

        166 11

        168 22

        168 23

        173 19

        176 14

        178 21

        179 17

        179 18

        179 8

        186 15

        194 9

        197 16

        230 2


The first column is the number of sentences and the second column the length of the sentence. Summing column one from this gives us `3490`.

{% highlight bash %}

cat moby-dick.txt | tr '\n' '  ' | tr '.' '\n'  | awk '{print NF}'  | sort -n | uniq -c | sort -n | tail -20 | awk '{sum += $1} END {print sum;}'

{% endhighlight %}

and the total sentence count from

{% highlight bash %}

cat moby-dick.txt | tr '\n' '  ' | tr '.' '\n'  | wc -l

{% endhighlight %}

is `7385`. So the last the last 20 lengths account for a little less than half the number of sentences.

Sorting the last 20 by sentence length using

{% highlight bash %}

cat moby-dick.txt | tr '\n' '  ' | tr '.' '\n'  | awk '{print NF}'  | sort -n | uniq -c | sort -n | tail -20 | sort -n -k2

{% endhighlight %}

gives us some more insight into the lengths.


        230 2

        179 8

        194 9

        166 11

        159 12

        162 13

        176 14

        186 15

        197 16

        179 17

        179 18

        173 19

        164 20

        178 21

        168 22

        168 23

        158 24

        158 25

        163 26

        153 27


which is that they're all less than 27 words. That's fairly conversational. However, the maximum sentence length is 394 and it even has two sentences that are 224 words long. This makes it quite unlikely that it's a childrens or a technical book. We can even go a step further and drop the `tail -20` to get a frequency distribution.


{% highlight bash %}

cat moby-dick.txt| tr '\n' ' ' | tr '.' '\n' | awk "{print NF}" | sort -n | uniq -c | sort -n| sort -n -k 2 | awk '{print $2 " " $1}'

{% endhighlight %}


and then plot that using `gnuplot` to get something like this


![Sentence lengths](/img/lengths.png)


The next thing we can try to approximate is the year of writing this. Something like

{% highlight bash %}

cat moby-dick.txt |  tr -Cs '[A-Za-z0-9]' '\n' | grep -w '[12][0-9][0-9][0-9]'

{% endhighlight %}

gives us all the years in the book. This first converts the text into one word per line (by changing all "non word" characters into newlines) and then looks for numbers that look like years. This gives us quite a list. Sticking a `wc -l` at the end gives us the number of matches (in our case 30). We can sum this and then again divide by the number of matches to get an average.

{% highlight bash %}

expr $(cat moby-dick.txt |  tr -Cs '[A-Za-z0-9]' '\n' | grep -w '[12][0-9][0-9][0-9]' | awk '{sum += $1} END {print sum;}') / $(cat moby-dick.txt |  tr -Cs '[A-Za-z0-9]' '\n' | grep -w '[12][0-9][0-9][0-9]' | wc -l)

{% endhighlight %}

This is hairy but actually runs for a two hundred thousand word text file in about 0.03 seconds on my computer. That's much lesser than the time needed to write a real program to do this. I get `1796`. It's likely that it was written a little after this date (unless it's futuristic speculative fiction of some kind) so let's say early 19 century.


So far, we have a non technical book for older audiences. It's approximately 600 pages spread across 170 chapters written in the early 19 century. Let's go on.


We can do a frequency analysis on the number of words. First lower case everything and get one word per line using

{% highlight bash %}

cat moby-dick.txt |  tr '[A-Z]' '[a-z]' | tr -Cs '[a-z0-9]' '\n'

{% endhighlight %}


Then pipe that through `sort | uniq -c | sort -n | tail -20` to get the most common 20 words in the book. The results are disappointing.


       1382 this

       1515 all

       1593 for

       1627 was

       1690 is

       1692 with

       1720 as

       1737 s

       1805 but

       1876 he

       2114 i

       2495 his

       2496 it

       3045 that

       4077 in

       4539 to

       4636 a

       6325 and

       6469 of

      14175 the


All these words don't give us any information about the content of the book. We can filter for larger words using by sticking a `grep .....` before the first sort to look only for words longer than 4 letters. This gives us


        252 queequeg

        257 stubb

        262 again

        268 after

        280 white

        282 seemed

        292 great

        295 before

        303 those

        308 about

        312 still

        327 captain

        382 though

        394 these

        410 other

        426 would

        604 their

        625 which

        854 there

       1150 whale


in about 1.6 seconds. You can see themes here. *Whale* is obviously something important. *Captain* makes the book either military or nautical. The whale suggests the latter. *Great* and *white* are not significant in themselves but with whale, they give you *great white whale* which is good. The *captain* is important in the story. There are also two words which you can't find in the dictionary - *queequeg* and *stubb*. It's likely that these are characters in the story. By changing the lengths of the words we filter, we get out some more stuff from the text. By using `....`, we get *ahab* and *ship*. Using `......`, we get *whaling*, *pequod* and *starbuck*. We can adjust the lengths like this and we get these words that are not in the dictionary - Ahab, Queequeg, Stubb, Pequod, Starbuck and Tashtego. We get these words that are in the dictionary - ship, white, whale, captain, whaling, harpooneers, harpooneer, leviathan, Nantucket.


So, we can judge that this is a non technical book for older audiences. It's approximately 600 pages spread across 170 chapters written in the early 19 century. It deals with a story on a whaling ship. The captain is an important character in the story. They are hunting for a white whale. It's likely that it's an American story (since Nantucket has a history of whaling). The main characters in the story are Ahab, Queequeg etc.


Now you can head on to the [wikipedia page of Moby Dick](https://en.wikipedia.org/wiki/Moby_dick) and see how close we've reached.


It's possible to squeeze out more information from the text. We can, for example, get bigrams from it with this (try it).

{% highlight bash %}

paste <(cat moby-dick.txt| tr '[A-Z]' '[a-z]' | tr -sC '[a-z0-9]' '\n') <(cat moby-dick.txt| tr '[A-Z]' '[a-z]' | tr -sC '[a-z0-9]' '\n' | tail -n +2) | sort | uniq -c | sort -n | tail -20

{% endhighlight %}


I think these tools are not sufficiently advertised in the modern developer community and it's a loss for them. I'm planning to put together a [course that teaches these skills](http://nibrahim.net.in/2013/08/03/unix_command_line_course.html) which I'm going to hold in Bangalore later this year. You should sign up onto my [trainings list](https://lists.hcoop.net/listinfo/trainings) or follow me on [twitter](https://twitter.com/noufalibrahim) if you want to know when I'm ready.


This course is also going to be a part of a larger boot camp style thing which I'm doing under the LycÓum banner so stay tuned.